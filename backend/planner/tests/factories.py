from itertools import accumulate

from planner.services.geo import haversine_mi
from planner.services.routing import RoutePath
from planner.services.weather import HourlyForecast

COS_40_DEG = 0.766


def straight_path(miles: float, mph: float, via: str = "Test Hwy", lat: float = 40.0) -> RoutePath:
    steps = max(2, int(miles))
    end_lon = -100 + miles / (69.0 * COS_40_DEG)
    coords = [(lat, -100 + (end_lon + 100) * k / steps) for k in range(steps + 1)]
    seg = [haversine_mi(a, b) for a, b in zip(coords, coords[1:])]
    return RoutePath(
        coords=tuple(coords),
        cum_mi=tuple(accumulate(seg, initial=0.0)),
        cum_s=tuple(accumulate((d / mph * 3600 for d in seg), initial=0.0)),
        via=via,
    )


def forecast(start_ts: int, hours: int, wind=5.0, rain=0.0, snow=0.0, overrides=None) -> HourlyForecast:
    winds, rains, snows = [wind] * hours, [rain] * hours, [snow] * hours
    for hour, (w, r, s) in (overrides or {}).items():
        winds[hour], rains[hour], snows[hour] = w, r, s
    return HourlyForecast(start_ts, tuple(winds), tuple(winds), tuple(rains), tuple(snows))
