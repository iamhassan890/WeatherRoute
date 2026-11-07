import logging
import math
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Iterable

import requests
from django.conf import settings
from django.core.cache import cache

from . import http
from .errors import ServiceError, UpstreamUnavailable
from .geo import LatLon

log = logging.getLogger(__name__)

SNAP_DEG = 0.05
CHUNK_SIZE = 100
MAX_PARALLEL_REQUESTS = 4
CACHE_TTL_S = 30 * 60
FORECAST_HORIZON_DAYS = 15
HOURLY_VARIABLES = ("wind_speed_10m", "wind_gusts_10m", "rain", "showers", "snowfall")


@dataclass(frozen=True)
class WeatherSample:
    wind_mph: float
    gust_mph: float | None
    rain_in_hr: float
    snow_in_hr: float


@dataclass(frozen=True)
class HourlyForecast:
    start_ts: int
    wind_mph: tuple[float | None, ...]
    gust_mph: tuple[float | None, ...]
    rain_in: tuple[float | None, ...]
    snow_in: tuple[float | None, ...]

    def sample(self, ts: float) -> WeatherSample | None:
        hour = (ts - self.start_ts) / 3600
        last = len(self.wind_mph) - 1
        if hour < 0 or hour > last:
            return None

        before = math.floor(hour)
        after = min(before + 1, last)
        fraction = hour - before
        precip_hour = min(math.ceil(hour), last)

        wind = _interpolate(self.wind_mph[before], self.wind_mph[after], fraction)
        rain, snow = self.rain_in[precip_hour], self.snow_in[precip_hour]
        if wind is None or rain is None or snow is None:
            return None
        return WeatherSample(
            wind_mph=wind,
            gust_mph=_interpolate(self.gust_mph[before], self.gust_mph[after], fraction),
            rain_in_hr=rain,
            snow_in_hr=snow,
        )


def _interpolate(a: float | None, b: float | None, t: float) -> float | None:
    if a is None or b is None:
        return a if t < 0.5 else b
    return a + (b - a) * t


def snap(point: LatLon) -> LatLon:
    lat, lon = point
    return round(round(lat / SNAP_DEG) * SNAP_DEG, 4), round(round(lon / SNAP_DEG) * SNAP_DEG, 4)


def forecast_window(departure: datetime, hours_needed: float) -> tuple[date, date]:
    start = departure.astimezone(timezone.utc)
    end = start + timedelta(hours=hours_needed + 1)
    horizon = datetime.now(timezone.utc).date() + timedelta(days=FORECAST_HORIZON_DAYS)
    return start.date(), min(end.date(), horizon)


def fetch_forecasts(points: Iterable[LatLon], start: date, end: date) -> dict[LatLon, HourlyForecast]:
    unique = sorted({snap(p) for p in points})
    keys = {p: f"wx:{p[0]}:{p[1]}:{start}:{end}" for p in unique}
    hits = cache.get_many(keys.values())
    result = {p: hits[k] for p, k in keys.items() if k in hits}
    missing = [p for p in unique if p not in result]
    if not missing:
        return result

    chunks = [missing[i : i + CHUNK_SIZE] for i in range(0, len(missing), CHUNK_SIZE)]
    with ThreadPoolExecutor(max_workers=MAX_PARALLEL_REQUESTS) as pool:
        responses = list(pool.map(lambda chunk: _request(chunk, start, end), chunks))

    fresh: dict[str, HourlyForecast] = {}
    for chunk, forecasts in zip(chunks, responses):
        for point, forecast in zip(chunk, forecasts):
            result[point] = forecast
            fresh[keys[point]] = forecast
    cache.set_many(fresh, CACHE_TTL_S)
    return result


def _request(points: list[LatLon], start: date, end: date) -> list[HourlyForecast]:
    params = {
        "latitude": ",".join(f"{lat:.4f}" for lat, _ in points),
        "longitude": ",".join(f"{lon:.4f}" for _, lon in points),
        "hourly": ",".join(HOURLY_VARIABLES),
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "timezone": "GMT",
        "timeformat": "unixtime",
        "wind_speed_unit": "mph",
        "precipitation_unit": "inch",
    }
    if settings.OPEN_METEO_API_KEY:
        params["apikey"] = settings.OPEN_METEO_API_KEY
    try:
        resp = http.session.get(settings.OPEN_METEO_URL, params=params, timeout=http.timeout())
    except requests.RequestException as exc:
        log.warning("weather request failed: %s", exc)
        raise UpstreamUnavailable("The weather service is unavailable right now. Please try again shortly.") from exc
    if resp.status_code == 429:
        raise UpstreamUnavailable("Weather provider rate limit reached. Please retry in a minute.")
    if not resp.ok:
        reason = _error_reason(resp)
        log.warning("weather request rejected: %s", reason)
        raise ServiceError(f"Weather service error: {reason}")

    data = resp.json()
    items = data if isinstance(data, list) else [data]
    if len(items) != len(points):
        raise ServiceError("Weather service returned an unexpected number of locations.")
    return [_parse(item["hourly"]) for item in items]


def _error_reason(resp: requests.Response) -> str:
    try:
        return resp.json().get("reason", resp.reason)
    except ValueError:
        return resp.reason


def _parse(hourly: dict) -> HourlyForecast:
    rain = tuple(
        None if r is None and s is None else (r or 0.0) + (s or 0.0)
        for r, s in zip(hourly["rain"], hourly["showers"])
    )
    return HourlyForecast(
        start_ts=int(hourly["time"][0]),
        wind_mph=tuple(hourly["wind_speed_10m"]),
        gust_mph=tuple(hourly["wind_gusts_10m"]),
        rain_in=rain,
        snow_in=tuple(hourly["snowfall"]),
    )
