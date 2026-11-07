import math
from typing import Sequence

EARTH_RADIUS_MI = 3958.8
MI_PER_DEG_LAT = 69.0

LatLon = tuple[float, float]


def haversine_mi(a: LatLon, b: LatLon) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (*a, *b))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * EARTH_RADIUS_MI * math.asin(min(1.0, math.sqrt(h)))


def lerp(a: LatLon, b: LatLon, t: float) -> LatLon:
    return a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t


def bearing_deg(a: LatLon, b: LatLon) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (*a, *b))
    dlon = lon2 - lon1
    y = math.sin(dlon) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def destination(origin: LatLon, bearing: float, distance_mi: float) -> LatLon:
    lat1, lon1 = map(math.radians, origin)
    brg = math.radians(bearing)
    d = distance_mi / EARTH_RADIUS_MI
    lat2 = math.asin(math.sin(lat1) * math.cos(d) + math.cos(lat1) * math.sin(d) * math.cos(brg))
    lon2 = lon1 + math.atan2(
        math.sin(brg) * math.sin(d) * math.cos(lat1),
        math.cos(d) - math.sin(lat1) * math.sin(lat2),
    )
    return math.degrees(lat2), (math.degrees(lon2) + 540) % 360 - 180


def simplify(points: Sequence[LatLon], tolerance_deg: float) -> list[int]:
    n = len(points)
    if n < 3:
        return list(range(n))

    tol2 = tolerance_deg**2
    candidates = [0]
    for i in range(1, n - 1):
        (lat, lon), (prev_lat, prev_lon) = points[i], points[candidates[-1]]
        if (lat - prev_lat) ** 2 + (lon - prev_lon) ** 2 > tol2:
            candidates.append(i)
    candidates.append(n - 1)

    keep = [False] * len(candidates)
    keep[0] = keep[-1] = True
    stack = [(0, len(candidates) - 1)]
    while stack:
        start, end = stack.pop()
        ay, ax = points[candidates[start]]
        by, bx = points[candidates[end]]
        dx, dy = bx - ax, by - ay
        seg2 = dx * dx + dy * dy
        farthest_d2, farthest = -1.0, -1
        for k in range(start + 1, end):
            py, px = points[candidates[k]]
            t = 0.0 if seg2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / seg2))
            d2 = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2
            if d2 > farthest_d2:
                farthest_d2, farthest = d2, k
        if farthest_d2 > tol2:
            keep[farthest] = True
            stack.append((start, farthest))
            stack.append((farthest, end))
    return [candidates[k] for k, kept in enumerate(keep) if kept]
