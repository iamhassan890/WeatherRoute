from dataclasses import dataclass, field
from datetime import datetime, timedelta

from django.conf import settings

from . import routing, weather
from .geo import LatLon, simplify
from .risk import Assessment, Risk, assess, levels_payload, thresholds_payload
from .routing import RoutePath
from .weather import WeatherSample

ROUTE_LABELS = "ABC"
DISPLAY_TOLERANCE_DEG = 0.0005
MIN_FINAL_LEG_MI = 0.05
NO_DATA_AVG_RISK = float(Risk.NO_TRAVEL)

CRITERIA: tuple[tuple[str, str], ...] = (
    ("no_travel_mi", "Fewest No-Travel miles"),
    ("severe_mi", "Fewest Severe miles"),
    ("high_mi", "Fewest High miles"),
    ("avg_risk", "Lowest average risk"),
    ("duration_s", "Shortest travel time"),
)


@dataclass(frozen=True)
class TripRequest:
    origin: LatLon
    destination: LatLon
    departure: datetime
    load_lb: float
    interval_mi: int


@dataclass
class Checkpoint:
    mile: float
    position: LatLon
    elapsed_s: float
    segment_mi: float
    weather: WeatherSample | None = None
    assessment: Assessment | None = None

    @property
    def risk(self) -> Risk | None:
        return self.assessment.level if self.assessment else None


@dataclass(frozen=True)
class RouteSummary:
    miles_by_level: tuple[float, ...]
    unknown_mi: float
    avg_risk: float | None
    max_risk: Risk | None

    def miles(self, level: Risk) -> float:
        return self.miles_by_level[level]


@dataclass
class RoutePlan:
    id: int
    path: RoutePath
    checkpoints: list[Checkpoint]
    summary: RouteSummary | None = field(default=None)

    @property
    def label(self) -> str:
        return ROUTE_LABELS[self.id]


def build_checkpoints(path: RoutePath, interval_mi: float) -> list[Checkpoint]:
    total = path.distance_mi
    miles = [k * interval_mi for k in range(int(total // interval_mi) + 1)]
    if total - miles[-1] > MIN_FINAL_LEG_MI:
        miles.append(total)
    else:
        miles[-1] = total

    midpoints = [(a + b) / 2 for a, b in zip(miles, miles[1:])]
    bounds = [0.0, *midpoints, total]
    checkpoints = []
    for i, mile in enumerate(miles):
        position, elapsed = path.locate(mile)
        checkpoints.append(Checkpoint(mile, position, elapsed, segment_mi=bounds[i + 1] - bounds[i]))
    return checkpoints


def summarize(checkpoints: list[Checkpoint]) -> RouteSummary:
    miles = [0.0] * len(Risk)
    unknown = weighted = 0.0
    for cp in checkpoints:
        if cp.risk is None:
            unknown += cp.segment_mi
        else:
            miles[cp.risk] += cp.segment_mi
            weighted += cp.risk * cp.segment_mi
    known = sum(miles)
    levels = [cp.risk for cp in checkpoints if cp.risk is not None]
    return RouteSummary(
        miles_by_level=tuple(miles),
        unknown_mi=unknown,
        avg_risk=weighted / known if known else None,
        max_risk=max(levels) if levels else None,
    )


def criteria_values(plan: RoutePlan) -> dict[str, float]:
    s = plan.summary
    assert s is not None
    return {
        "no_travel_mi": round(s.miles(Risk.NO_TRAVEL), 1),
        "severe_mi": round(s.miles(Risk.SEVERE), 1),
        "high_mi": round(s.miles(Risk.HIGH), 1),
        "avg_risk": round(s.avg_risk if s.avg_risk is not None else NO_DATA_AVG_RISK, 2),
        "duration_s": round(plan.path.duration_s),
    }


def rank(plans: list[RoutePlan]) -> list[RoutePlan]:
    return sorted(plans, key=lambda p: tuple(criteria_values(p)[key] for key, _ in CRITERIA))


def explain(ranked: list[RoutePlan]) -> str:
    if len(ranked) == 1:
        return "Only one route is available between these points."
    best, runner_up = ranked[0], ranked[1]
    best_values, other_values = criteria_values(best), criteria_values(runner_up)
    for key, title in CRITERIA:
        if best_values[key] != other_values[key]:
            ours, theirs = _format_value(key, best_values[key]), _format_value(key, other_values[key])
            return f"{title}: {ours} vs {theirs} on Route {runner_up.label}."
    return f"Routes {best.label} and {runner_up.label} are equivalent on every criterion."


def _format_value(key: str, value: float) -> str:
    if key == "duration_s":
        return f"{int(value // 3600)} h {int(value % 3600 // 60):02d} m"
    if key == "avg_risk":
        return f"{value:.2f}"
    return f"{value:g} mi"


def plan_trip(trip: TripRequest) -> dict:
    paths = routing.find_routes(trip.origin, trip.destination)
    plans = [RoutePlan(i, path, build_checkpoints(path, trip.interval_mi)) for i, path in enumerate(paths)]

    longest_h = max(p.duration_s for p in paths) / 3600
    start, end = weather.forecast_window(trip.departure, longest_h)
    forecasts = weather.fetch_forecasts((cp.position for p in plans for cp in p.checkpoints), start, end)

    departure_ts = trip.departure.timestamp()
    for plan in plans:
        for cp in plan.checkpoints:
            forecast = forecasts.get(weather.snap(cp.position))
            cp.weather = forecast.sample(departure_ts + cp.elapsed_s) if forecast else None
            if cp.weather:
                w = cp.weather
                cp.assessment = assess(w.wind_mph, w.rain_in_hr, w.snow_in_hr, trip.load_lb)
        plan.summary = summarize(plan.checkpoints)

    ranked = rank(plans)
    best = ranked[0]
    return {
        "request": {
            "origin": {"lat": trip.origin[0], "lon": trip.origin[1]},
            "destination": {"lat": trip.destination[0], "lon": trip.destination[1]},
            "departure": trip.departure.isoformat(),
            "load_lb": trip.load_lb,
            "interval_mi": trip.interval_mi,
        },
        "routes": [_route_payload(p, trip.departure, ranked.index(p) + 1) for p in plans],
        "recommendation": {
            "route_id": best.id,
            "reason": explain(ranked),
            "ranking": [p.id for p in ranked],
            "criteria": [title for _, title in CRITERIA],
            "warnings": _warnings(best, len(plans)),
        },
        "risk_levels": levels_payload(),
        "thresholds": thresholds_payload(),
        "assumptions": {"truck_max_speed_mph": settings.TRUCK_MAX_SPEED_MPH},
    }


def _warnings(best: RoutePlan, route_count: int) -> list[str]:
    s = best.summary
    assert s is not None
    warnings = []
    if s.miles(Risk.NO_TRAVEL) > 0:
        warnings.append(
            f"Even the recommended route crosses {s.miles(Risk.NO_TRAVEL):.0f} mi of No-Travel conditions. "
            "Consider delaying departure."
        )
    elif s.miles(Risk.SEVERE) > 0:
        warnings.append(f"The recommended route still has {s.miles(Risk.SEVERE):.0f} mi of Severe conditions.")
    if s.unknown_mi > 0:
        warnings.append(f"No forecast is available for {s.unknown_mi:.0f} mi (beyond the forecast horizon).")
    if route_count < len(ROUTE_LABELS):
        warnings.append(f"Only {route_count} distinct route(s) were found between these points.")
    return warnings


def _route_payload(plan: RoutePlan, departure: datetime, rank_position: int) -> dict:
    path, s = plan.path, plan.summary
    assert s is not None
    keep = simplify(path.coords, DISPLAY_TOLERANCE_DEG)
    return {
        "id": plan.id,
        "label": plan.label,
        "via": path.via,
        "rank": rank_position,
        "recommended": rank_position == 1,
        "distance_mi": round(path.distance_mi, 1),
        "duration_s": round(path.duration_s),
        "arrival": (departure + timedelta(seconds=round(path.duration_s))).isoformat(),
        "geometry": [[round(path.coords[i][0], 5), round(path.coords[i][1], 5)] for i in keep],
        "times_s": [round(path.cum_s[i]) for i in keep],
        "summary": {
            "miles_by_level": [round(m, 1) for m in s.miles_by_level],
            "unknown_mi": round(s.unknown_mi, 1),
            "avg_risk": None if s.avg_risk is None else round(s.avg_risk, 2),
            "max_risk": None if s.max_risk is None else int(s.max_risk),
        },
        "checkpoints": [_checkpoint_payload(cp, departure) for cp in plan.checkpoints],
    }


def _checkpoint_payload(cp: Checkpoint, departure: datetime) -> dict:
    w, a = cp.weather, cp.assessment
    return {
        "mile": round(cp.mile, 1),
        "lat": round(cp.position[0], 5),
        "lon": round(cp.position[1], 5),
        "eta": (departure + timedelta(seconds=round(cp.elapsed_s))).isoformat(),
        "segment_mi": round(cp.segment_mi, 2),
        "wind_mph": None if w is None else round(w.wind_mph, 1),
        "gust_mph": None if w is None or w.gust_mph is None else round(w.gust_mph, 1),
        "rain_in_hr": None if w is None else round(w.rain_in_hr, 3),
        "snow_in_hr": None if w is None else round(w.snow_in_hr, 2),
        "risk": None if a is None else int(a.level),
        "factors": None if a is None else {"wind": int(a.wind), "rain": int(a.rain), "snow": int(a.snow)},
        "reasons": [] if a is None else list(a.reasons),
    }
