import bisect
import logging
from collections import Counter
from dataclasses import dataclass
from itertools import accumulate, pairwise

import requests
from django.conf import settings
from django.core.cache import cache

from . import http
from .errors import NoRouteFound, ServiceError, UpstreamUnavailable
from .geo import LatLon, bearing_deg, destination, haversine_mi, lerp

log = logging.getLogger(__name__)

ROUTE_COUNT = 3
CACHE_TTL_S = 60 * 60

MAX_DETOUR_RATIO = 1.6
MAX_OVERLAP = 0.85
VIA_OFFSETS = (0.15, -0.15, 0.3, -0.3, 0.45, -0.45)
MAX_VIA_OFFSET_MI = 150

MAX_SNAP_MI = 15

SPUR_MATCH_DEG = 0.003
MIN_SPUR_MI = 0.5
MAX_SPUR_SHARE = 0.4

METERS_PER_MILE = 1609.344


@dataclass(frozen=True)
class RoutePath:
    coords: tuple[LatLon, ...]
    cum_mi: tuple[float, ...]
    cum_s: tuple[float, ...]
    via: str

    @property
    def distance_mi(self) -> float:
        return self.cum_mi[-1]

    @property
    def duration_s(self) -> float:
        return self.cum_s[-1]

    def locate(self, mile: float) -> tuple[LatLon, float]:
        mile = min(max(mile, 0.0), self.distance_mi)
        i = min(bisect.bisect_right(self.cum_mi, mile) - 1, len(self.coords) - 2)
        span = self.cum_mi[i + 1] - self.cum_mi[i]
        t = 0.0 if span == 0 else (mile - self.cum_mi[i]) / span
        seconds = self.cum_s[i] + (self.cum_s[i + 1] - self.cum_s[i]) * t
        return lerp(self.coords[i], self.coords[i + 1], t), seconds


def find_routes(origin: LatLon, dest: LatLon) -> list[RoutePath]:
    key = f"routes:{origin[0]:.5f},{origin[1]:.5f}:{dest[0]:.5f},{dest[1]:.5f}"
    cached = cache.get(key)
    if cached is not None:
        return cached

    routes: list[RoutePath] = []
    for path in osrm_route([origin, dest], alternatives=ROUTE_COUNT):
        if not _duplicates_any(path, routes):
            routes.append(path)
    routes = routes[:ROUTE_COUNT]
    if len(routes) < ROUTE_COUNT:
        routes += _via_alternatives(origin, dest, routes, ROUTE_COUNT - len(routes))

    routes.sort(key=lambda p: p.duration_s)
    cache.set(key, routes, CACHE_TTL_S)
    return routes


def _via_alternatives(origin: LatLon, dest: LatLon, existing: list[RoutePath], needed: int) -> list[RoutePath]:
    fastest = existing[0]
    straight_mi = haversine_mi(origin, dest)
    midpoint, _ = fastest.locate(fastest.distance_mi / 2)
    heading = bearing_deg(origin, dest)

    found: list[RoutePath] = []
    for fraction in VIA_OFFSETS:
        if len(found) >= needed:
            break
        offset_mi = min(abs(fraction) * straight_mi, MAX_VIA_OFFSET_MI)
        side = 90 if fraction > 0 else -90
        via = destination(midpoint, heading + side, offset_mi)
        try:
            candidate = osrm_route([origin, via, dest], alternatives=0)[0]
        except ServiceError as exc:
            log.info("skipping via-point candidate: %s", exc.message)
            continue
        too_slow = candidate.duration_s > fastest.duration_s * MAX_DETOUR_RATIO
        if not too_slow and not _duplicates_any(candidate, existing + found):
            found.append(candidate)
    return found


def _duplicates_any(path: RoutePath, others: list[RoutePath]) -> bool:
    return any(overlap_ratio(path, other) > MAX_OVERLAP for other in others)


def overlap_ratio(a: RoutePath, b: RoutePath, step_mi: float = 1.0, cell_deg: float = 0.01) -> float:
    def cells(path: RoutePath, step: float) -> list[tuple[int, int]]:
        count = max(1, int(path.distance_mi / step))
        out = []
        for k in range(count + 1):
            (lat, lon), _ = path.locate(k * path.distance_mi / count)
            out.append((round(lat / cell_deg), round(lon / cell_deg)))
        return out

    footprint = set(cells(b, step_mi / 2))
    samples = cells(a, step_mi)
    near = sum(
        1
        for row, col in samples
        if any((row + dr, col + dc) in footprint for dr in (-1, 0, 1) for dc in (-1, 0, 1))
    )
    return near / len(samples)


def osrm_route(waypoints: list[LatLon], alternatives: int) -> list[RoutePath]:
    coords = ";".join(f"{lon:.6f},{lat:.6f}" for lat, lon in waypoints)
    params = {
        "alternatives": str(alternatives) if alternatives else "false",
        "overview": "full",
        "geometries": "geojson",
        "annotations": "duration",
        "steps": "true",
    }
    last_error = "no routing servers configured"
    for base in settings.OSRM_BASE_URLS:
        try:
            resp = http.session.get(f"{base}/route/v1/driving/{coords}", params=params, timeout=http.timeout())
        except requests.RequestException as exc:
            last_error = str(exc)
            continue
        if resp.status_code == 429 or resp.status_code >= 500:
            last_error = f"HTTP {resp.status_code} from {base}"
            continue
        try:
            data = resp.json()
        except ValueError:
            last_error = f"invalid JSON from {base}"
            continue

        code = data.get("code")
        if code in ("NoRoute", "NoSegment"):
            raise NoRouteFound("No drivable route found between these locations.")
        if code != "Ok" or not data.get("routes"):
            last_error = data.get("message") or f"OSRM returned {code}"
            continue

        snapped = data.get("waypoints") or []
        _check_endpoints_on_network(snapped)
        via = None
        if len(waypoints) > 2:
            lon, lat = snapped[1]["location"]
            via = (lat, lon)
        return [_path_from_osrm(route, via) for route in data["routes"]]

    log.warning("routing failed: %s", last_error)
    raise UpstreamUnavailable("The routing service is unavailable right now. Please try again shortly.")


def _check_endpoints_on_network(snapped: list[dict]) -> None:
    if not snapped:
        return
    for role, waypoint in (("origin", snapped[0]), ("destination", snapped[-1])):
        moved_mi = waypoint.get("distance", 0.0) / METERS_PER_MILE
        if moved_mi > MAX_SNAP_MI:
            raise NoRouteFound(
                f"No drivable route found: the {role} is {moved_mi:,.0f} mi from any road "
                "connected to the other end of the trip."
            )


def _path_from_osrm(route: dict, via: LatLon | None = None) -> RoutePath:
    coords = [(lat, lon) for lon, lat in route["geometry"]["coordinates"]]
    seg_mi = [haversine_mi(a, b) for a, b in pairwise(coords)]

    min_s_per_mi = 3600 / settings.TRUCK_MAX_SPEED_MPH
    seg_s = [max(s, d * min_s_per_mi) for s, d in zip(_segment_seconds(route, seg_mi), seg_mi)]

    if via is not None:
        via_index = min(range(len(coords)), key=lambda i: (coords[i][0] - via[0]) ** 2 + (coords[i][1] - via[1]) ** 2)
        coords, seg_mi, seg_s = trim_via_spur(coords, seg_mi, seg_s, via_index, min_s_per_mi)

    return RoutePath(
        coords=tuple(coords),
        cum_mi=tuple(accumulate(seg_mi, initial=0.0)),
        cum_s=tuple(accumulate(seg_s, initial=0.0)),
        via=_main_roads(route),
    )


def trim_via_spur(
    coords: list[LatLon],
    seg_mi: list[float],
    seg_s: list[float],
    via_index: int,
    min_s_per_mi: float,
) -> tuple[list[LatLon], list[float], list[float]]:
    def cell(p: LatLon) -> tuple[int, int]:
        return round(p[0] / SPUR_MATCH_DEG), round(p[1] / SPUR_MATCH_DEG)

    first_visit: dict[tuple[int, int], int] = {}
    for i in range(via_index + 1):
        first_visit.setdefault(cell(coords[i]), i)

    leave, rejoin = via_index, -1
    for k in range(via_index + 1, len(coords)):
        row, col = cell(coords[k])
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                visit = first_visit.get((row + dr, col + dc))
                if visit is None or visit >= via_index:
                    continue
                if visit < leave or (visit == leave and k > rejoin):
                    leave, rejoin = visit, k

    if rejoin < 0:
        return coords, seg_mi, seg_s
    spur_mi = sum(seg_mi[leave:rejoin])
    if spur_mi < MIN_SPUR_MI or spur_mi > MAX_SPUR_SHARE * sum(seg_mi):
        return coords, seg_mi, seg_s

    gap_mi = haversine_mi(coords[leave], coords[rejoin])
    return (
        coords[: leave + 1] + coords[rejoin:],
        seg_mi[:leave] + [gap_mi] + seg_mi[rejoin:],
        seg_s[:leave] + [gap_mi * min_s_per_mi] + seg_s[rejoin:],
    )


def _segment_seconds(route: dict, seg_mi: list[float]) -> list[float]:
    annotated = [d for leg in route["legs"] for d in leg.get("annotation", {}).get("duration", [])]
    total = float(route["duration"])
    if len(annotated) == len(seg_mi) and sum(annotated) > 0:
        scale = total / sum(annotated)
        return [d * scale for d in annotated]
    distance = sum(seg_mi) or 1.0
    return [total * d / distance for d in seg_mi]


def _main_roads(route: dict) -> str:
    refs: Counter[str] = Counter()
    names: Counter[str] = Counter()
    for leg in route["legs"]:
        for step in leg.get("steps", []):
            distance = step.get("distance", 0.0)
            if ref := (step.get("ref") or "").split(";")[0].strip():
                refs[ref] += distance
            elif name := (step.get("name") or "").strip():
                names[name] += distance
    top = refs or names
    return ", ".join(name for name, _ in top.most_common(2)) or "local roads"
