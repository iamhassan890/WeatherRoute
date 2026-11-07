from datetime import datetime, timezone
from unittest import mock

from django.test import SimpleTestCase

from planner.services import planner
from planner.services.planner import Checkpoint, RoutePlan, TripRequest, build_checkpoints, rank, summarize
from planner.services.risk import Assessment, Risk
from planner.services.weather import HourlyForecast

from .factories import forecast, straight_path

DEPARTURE = datetime(2026, 11, 8, 12, 0, tzinfo=timezone.utc)


class CheckpointTests(SimpleTestCase):
    def test_checkpoints_every_interval_plus_destination(self):
        path = straight_path(103, mph=50)
        cps = build_checkpoints(path, 25)
        miles = [round(cp.mile, 1) for cp in cps]
        self.assertEqual(miles[:5], [0, 25, 50, 75, 100])
        self.assertAlmostEqual(cps[-1].mile, path.distance_mi)

    def test_owned_segments_cover_the_whole_route(self):
        path = straight_path(103, mph=50)
        for interval in (10, 25, 50):
            cps = build_checkpoints(path, interval)
            self.assertAlmostEqual(sum(cp.segment_mi for cp in cps), path.distance_mi, places=6)

    def test_elapsed_time_follows_route_speed(self):
        path = straight_path(100, mph=50)
        cps = build_checkpoints(path, 50)
        self.assertAlmostEqual(cps[1].elapsed_s, 3600, delta=60)


class SummaryAndRankingTests(SimpleTestCase):
    def plan(self, idx, duration_h, risks):
        path = straight_path(10 * len(risks), mph=10 * len(risks) / duration_h)
        cps = [
            Checkpoint(
                mile=i * 10,
                position=(0, 0),
                elapsed_s=0,
                segment_mi=10,
                assessment=Assessment(Risk(r), Risk(r), Risk.LOW, Risk.LOW, ()),
            )
            for i, r in enumerate(risks)
        ]
        p = RoutePlan(idx, path, cps)
        p.summary = summarize(cps)
        return p

    def test_summary_miles_and_average(self):
        s = self.plan(0, 1, [0, 2, 2, 3]).summary
        self.assertEqual(s.miles(Risk.HIGH), 20)
        self.assertEqual(s.miles(Risk.SEVERE), 10)
        self.assertAlmostEqual(s.avg_risk, (0 + 2 + 2 + 3) / 4)
        self.assertEqual(s.max_risk, Risk.SEVERE)

    def test_fewest_severe_miles_beats_faster_route(self):
        fast_but_severe = self.plan(0, 5, [0, 3, 0, 0])
        slow_but_high = self.plan(1, 9, [2, 2, 2, 2])
        self.assertEqual(rank([fast_but_severe, slow_but_high])[0].id, 1)

    def test_then_fewest_high_miles(self):
        a = self.plan(0, 5, [2, 2, 0, 0])
        b = self.plan(1, 9, [2, 1, 1, 1])
        self.assertEqual(rank([a, b])[0].id, 1)

    def test_then_lowest_average_risk(self):
        a = self.plan(0, 5, [1, 1, 1, 0])
        b = self.plan(1, 9, [1, 0, 0, 0])
        self.assertEqual(rank([a, b])[0].id, 1)

    def test_then_shortest_time(self):
        a = self.plan(0, 9, [1, 0, 0, 0])
        b = self.plan(1, 5, [0, 0, 0, 1])
        self.assertEqual(rank([a, b])[0].id, 1)

    def test_no_travel_is_worse_than_severe(self):
        severe = self.plan(0, 5, [3, 3, 3, 0])
        no_travel = self.plan(1, 5, [4, 0, 0, 0])
        self.assertEqual(rank([no_travel, severe])[0].id, 0)

    def test_explanation_names_the_deciding_criterion(self):
        a = self.plan(0, 5, [0, 3, 0, 0])
        b = self.plan(1, 9, [2, 2, 2, 2])
        reason = planner.explain(rank([a, b]))
        self.assertTrue(reason.startswith("Fewest Severe miles: 0 mi vs 10 mi on Route A"), reason)


class ForecastSamplingTests(SimpleTestCase):
    def test_wind_is_interpolated_and_precip_uses_the_hour_containing_ts(self):
        f = HourlyForecast(0, (10.0, 20.0, 30.0), (10.0, 20.0, 30.0), (0.0, 0.2, 0.4), (0.0, 0.0, 0.0))
        s = f.sample(1.5 * 3600)
        self.assertAlmostEqual(s.wind_mph, 25.0)
        self.assertAlmostEqual(s.rain_in_hr, 0.4)

    def test_outside_window_returns_none(self):
        f = forecast(0, 3)
        self.assertIsNone(f.sample(-1))
        self.assertIsNone(f.sample(3 * 3600))


class PlanTripTests(SimpleTestCase):
    def test_weather_is_sampled_at_each_checkpoint_eta(self):
        path = straight_path(100, mph=50)
        start = int(DEPARTURE.timestamp())
        storm_at_hour_two = forecast(start, 48, overrides={2: (60.0, 0.0, 0.0)})
        trip = TripRequest((40, -100), (40, -98), DEPARTURE, load_lb=20_000, interval_mi=25)

        def fake_forecasts(points, *_):
            return {planner.weather.snap(p): storm_at_hour_two for p in points}

        with mock.patch.object(planner.routing, "find_routes", return_value=[path]), \
             mock.patch.object(planner.weather, "fetch_forecasts", side_effect=fake_forecasts):
            result = planner.plan_trip(trip)

        risks = [cp["risk"] for cp in result["routes"][0]["checkpoints"]]
        self.assertEqual(risks[0], Risk.LOW)
        self.assertEqual(risks[-1], Risk.NO_TRAVEL)
        self.assertEqual(result["recommendation"]["route_id"], 0)
        self.assertTrue(result["recommendation"]["warnings"])
