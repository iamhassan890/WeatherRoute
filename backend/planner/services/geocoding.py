import logging
import re

import requests
from django.conf import settings
from django.core.cache import cache

from . import http
from .errors import UpstreamUnavailable

log = logging.getLogger(__name__)

CACHE_TTL_S = 24 * 60 * 60
COORDINATES = re.compile(r"^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$")
LOOKUP_ERRORS = (requests.RequestException, ValueError, KeyError)


def search(query: str, limit: int = 6) -> list[dict]:
    match = COORDINATES.match(query)
    if match:
        lat, lon = float(match[1]), float(match[2])
        if -90 <= lat <= 90 and -180 <= lon <= 180:
            return [{"label": f"{lat:.5f}, {lon:.5f}", "lat": lat, "lon": lon}]

    key = f"geocode:{limit}:{query.strip().lower()}"
    cached = cache.get(key)
    if cached is not None:
        return cached

    try:
        results = _photon(query, limit)
    except LOOKUP_ERRORS as exc:
        log.info("photon failed (%s), trying nominatim", exc)
        try:
            results = _nominatim(query, limit)
        except LOOKUP_ERRORS as fallback_exc:
            log.warning("geocoding failed: %s", fallback_exc)
            raise UpstreamUnavailable("Place search is unavailable right now. Please try again shortly.") from fallback_exc

    cache.set(key, results, CACHE_TTL_S)
    return results


def _photon(query: str, limit: int) -> list[dict]:
    resp = http.session.get(
        settings.PHOTON_URL, params={"q": query, "limit": limit, "lang": "en"}, timeout=http.timeout()
    )
    resp.raise_for_status()
    results, seen = [], set()
    for feature in resp.json()["features"]:
        props = feature["properties"]
        street = " ".join(filter(None, (props.get("housenumber"), props.get("street"))))
        parts: list[str] = []
        for part in (props.get("name"), street, props.get("city"), props.get("state"), props.get("country")):
            if part and part not in parts:
                parts.append(part)
        label = ", ".join(parts)
        if not label or label in seen:
            continue
        seen.add(label)
        lon, lat = feature["geometry"]["coordinates"]
        results.append({"label": label, "lat": lat, "lon": lon})
    return results


def _nominatim(query: str, limit: int) -> list[dict]:
    resp = http.session.get(
        settings.NOMINATIM_URL,
        params={"q": query, "format": "jsonv2", "limit": limit},
        timeout=http.timeout(),
    )
    resp.raise_for_status()
    return [{"label": r["display_name"], "lat": float(r["lat"]), "lon": float(r["lon"])} for r in resp.json()]
