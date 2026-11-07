from datetime import timedelta
from unittest import mock

from django.core.cache import cache
from django.test import SimpleTestCase
from django.utils import timezone

from planner.services import planner, weather
from planner.services.errors import UpstreamUnavailable

from .factories import forecast, straight_path


def payload(**overrides):
    body = {
        "origin": {"lat": 40.0, "lon": -100.0, "label": "A"},
        "destination": {"lat": 40.0, "lon": -98.0, "label": "B"},
        "departure": (timezone.now() + timedelta(hours=1)).isoformat(),
        "load_lb": 35000,
        "interval_mi": 25,
    }
    body.update(overrides)
    return body


class PlanApiTests(SimpleTestCase):
    def setUp(self):
        cache.clear()

    def post(self, body):
        return self.client.post("/api/plan", body, content_type="application/json")

    def test_rejects_past_departure(self):
        resp = self.post(payload(departure="2020-01-01T00:00:00Z"))
        self.assertEqual(resp.status_code, 400)
        self.assertIn("departure", resp.json())

    def test_rejects_unknown_interval(self):
        resp = self.post(payload(interval_mi=30))
        self.assertEqual(resp.status_code, 400)

    def test_returns_routes_and_recommendation(self):
        paths = [straight_path(100, 50, via="I 80"), straight_path(110, 50, via="US 6", lat=40.2)]

        def fake_forecasts(points, *_):
            start = int(timezone.now().timestamp()) // 3600 * 3600 - 3600
            return {weather.snap(p): forecast(start, 72) for p in points}

        with mock.patch.object(planner.routing, "find_routes", return_value=paths), \
             mock.patch.object(planner.weather, "fetch_forecasts", side_effect=fake_forecasts):
            resp = self.post(payload())

        self.assertEqual(resp.status_code, 200, resp.content)
        body = resp.json()
        self.assertEqual([r["label"] for r in body["routes"]], ["A", "B"])
        self.assertEqual(body["recommendation"]["route_id"], 0)
        self.assertIn("Shortest travel time", body["recommendation"]["reason"])
        self.assertEqual(len(body["routes"][0]["geometry"]), len(body["routes"][0]["times_s"]))

    def test_upstream_failure_is_a_clean_503(self):
        with mock.patch.object(planner.routing, "find_routes", side_effect=UpstreamUnavailable("down")):
            resp = self.post(payload())
        self.assertEqual(resp.status_code, 503)
        self.assertEqual(resp.json(), {"detail": "down"})
