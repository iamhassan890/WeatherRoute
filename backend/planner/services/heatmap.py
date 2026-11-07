import math
from dataclasses import dataclass

from . import routing, weather
from .geo import MI_PER_DEG_LAT, LatLon, haversine_mi
from .planner import TripRequest
from .risk import assess
from .routing import RoutePath

HOURS = 48
BUFFER_MI = 35
MAX_POINTS = 240
MIN_SPACING_MI = 6.0
SPACING_GROWTH = 1.15
MAX_SAMPLE_STEP_MI = 5.0
MIN_LON_SCALE = 0.2


@dataclass(frozen=True)
class CorridorGrid:
    lat0: float
    lon0: float
    dlat: float
    dlon: float
    rows: int
    cols: int
    cells: tuple[tuple[int, int], ...]

    def point(self, row: int, col: int) -> LatLon:
        return round(self.lat0 + row * self.dlat, 4), round(self.lon0 + col * self.dlon, 4)


def build_corridor(paths: list[RoutePath], buffer_mi: float = BUFFER_MI, max_points: int = MAX_POINTS) -> CorridorGrid:
    total_mi = sum(p.distance_mi for p in paths)
    corridor_area = total_mi * 2 * buffer_mi + math.pi * buffer_mi**2
    spacing = max(MIN_SPACING_MI, math.sqrt(corridor_area / max_points))
    while True:
        grid = _grid(paths, spacing, buffer_mi)
        if len(grid.cells) <= max_points:
            return grid
        spacing *= SPACING_GROWTH


def _sample_routes(paths: list[RoutePath], step_mi: float) -> list[LatLon]:
    samples: list[LatLon] = []
    for path in paths:
        n = max(1, math.ceil(path.distance_mi / step_mi))
        samples += [path.locate(k * path.distance_mi / n)[0] for k in range(n + 1)]
    return samples


def _grid(paths: list[RoutePath], spacing_mi: float, buffer_mi: float) -> CorridorGrid:
    samples = _sample_routes(paths, min(MAX_SAMPLE_STEP_MI, spacing_mi / 2))
    lats = [lat for lat, _ in samples]
    lons = [lon for _, lon in samples]

    mid_lat = (min(lats) + max(lats)) / 2
    mi_per_deg_lon = MI_PER_DEG_LAT * max(math.cos(math.radians(mid_lat)), MIN_LON_SCALE)
    dlat, dlon = spacing_mi / MI_PER_DEG_LAT, spacing_mi / mi_per_deg_lon
    pad_lat, pad_lon = buffer_mi / MI_PER_DEG_LAT, buffer_mi / mi_per_deg_lon

    lat0 = math.floor((min(lats) - pad_lat) / dlat) * dlat
    lon0 = math.floor((min(lons) - pad_lon) / dlon) * dlon
    rows = math.ceil((max(lats) + pad_lat - lat0) / dlat) + 1
    cols = math.ceil((max(lons) + pad_lon - lon0) / dlon) + 1
    reach = math.ceil(buffer_mi / spacing_mi) + 1

    cells: set[tuple[int, int]] = set()
    for lat, lon in samples:
        center_row, center_col = round((lat - lat0) / dlat), round((lon - lon0) / dlon)
        for r in range(max(0, center_row - reach), min(rows, center_row + reach + 1)):
            for c in range(max(0, center_col - reach), min(cols, center_col + reach + 1)):
                if (r, c) in cells:
                    continue
                if haversine_mi((lat, lon), (lat0 + r * dlat, lon0 + c * dlon)) <= buffer_mi:
                    cells.add((r, c))
    return CorridorGrid(lat0, lon0, dlat, dlon, rows, cols, tuple(sorted(cells)))


def build_heatmap(trip: TripRequest, hours: int = HOURS) -> dict:
    paths = routing.find_routes(trip.origin, trip.destination)
    grid = build_corridor(paths)
    points = [grid.point(r, c) for r, c in grid.cells]

    first_hour = trip.departure.replace(minute=0, second=0, microsecond=0)
    start, end = weather.forecast_window(first_hour, hours)
    forecasts = weather.fetch_forecasts(points, start, end)
    series = [forecasts.get(weather.snap(p)) for p in points]

    values: dict[str, list[list[float | int | None]]] = {"risk": [], "wind": [], "rain": [], "snow": []}
    for hour in range(hours + 1):
        ts = first_hour.timestamp() + hour * 3600
        frame: dict[str, list[float | int | None]] = {key: [] for key in values}
        for forecast in series:
            sample = forecast.sample(ts) if forecast else None
            if sample is None:
                for column in frame.values():
                    column.append(None)
                continue
            level = assess(sample.wind_mph, sample.rain_in_hr, sample.snow_in_hr, trip.load_lb).level
            frame["risk"].append(int(level))
            frame["wind"].append(round(sample.wind_mph, 1))
            frame["rain"].append(round(sample.rain_in_hr, 3))
            frame["snow"].append(round(sample.snow_in_hr, 2))
        for key, column in frame.items():
            values[key].append(column)

    return {
        "start": first_hour.isoformat(),
        "hours": hours,
        "buffer_mi": BUFFER_MI,
        "grid": {
            "lat0": grid.lat0,
            "lon0": grid.lon0,
            "dlat": grid.dlat,
            "dlon": grid.dlon,
            "rows": grid.rows,
            "cols": grid.cols,
        },
        "cells": [list(cell) for cell in grid.cells],
        "values": values,
    }
