from unittest import mock

from django.core.cache import cache
from django.test import SimpleTestCase

from planner.services import routing
from planner.services.errors import NoRouteFound


def osrm_response(origin_moved_m: float) -> mock.Mock:
    resp = mock.Mock(status_code=200)
    resp.json.return_value = {
        "code": "Ok",
        "routes": [
            {
                "duration": 3600.0,
                "geometry": {"coordinates": [[-100.0, 40.0], [-99.0, 40.0]]},
                "legs": [{"annotation": {"duration": [3600.0]}, "steps": [{"ref": "I 80", "distance": 85000}]}],
            }
        ],
        "waypoints": [
            {"distance": origin_moved_m, "location": [-100.0, 40.0]},
            {"distance": 3.0, "location": [-99.0, 40.0]},
        ],
    }
    return resp


class OsrmSnappingTests(SimpleTestCase):
    def setUp(self):
        cache.clear()

    def test_route_is_parsed_and_named_after_main_road(self):
        with mock.patch.object(routing.http.session, "get", return_value=osrm_response(5.0)):
            [path] = routing.osrm_route([(40.0, -100.0), (40.0, -99.0)], alternatives=0)
        self.assertEqual(path.via, "I 80")
        self.assertAlmostEqual(path.duration_s, 3600, delta=1)

    def test_endpoint_snapped_to_another_continent_is_rejected(self):
        with mock.patch.object(routing.http.session, "get", return_value=osrm_response(6_648_700)):
            with self.assertRaisesMessage(NoRouteFound, "origin is 4,131 mi from any road"):
                routing.osrm_route([(41.88, -87.62), (51.51, -0.13)], alternatives=0)
