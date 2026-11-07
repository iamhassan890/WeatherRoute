from django.test import SimpleTestCase

from planner.services.geo import bearing_deg, destination, haversine_mi, simplify
from planner.services.heatmap import build_corridor
from planner.services.routing import overlap_ratio, trim_via_spur

from .factories import straight_path


class GeoTests(SimpleTestCase):
    def test_haversine_known_distance(self):
        chicago, new_york = (41.8781, -87.6298), (40.7128, -74.0060)
        self.assertAlmostEqual(haversine_mi(chicago, new_york), 711, delta=3)

    def test_destination_round_trip(self):
        start = (39.0, -95.0)
        end = destination(start, 45, 100)
        self.assertAlmostEqual(haversine_mi(start, end), 100, delta=0.1)
        self.assertAlmostEqual(bearing_deg(start, end), 45, delta=0.5)

    def test_simplify_drops_collinear_points_and_keeps_corners(self):
        line = [(0, x / 10) for x in range(11)] + [(y / 10, 1.0) for y in range(1, 11)]
        kept = simplify(line, 0.001)
        self.assertEqual([line[i] for i in kept], [(0, 0.0), (0, 1.0), (1.0, 1.0)])


class SpurTrimTests(SimpleTestCase):
    def build(self, coords):
        seg_mi = [haversine_mi(a, b) for a, b in zip(coords, coords[1:])]
        return coords, seg_mi, [d * 60 for d in seg_mi]

    def test_out_and_back_to_via_point_is_removed(self):
        main_road = [(40.0, -100 + k * 0.1) for k in range(6)]
        side_road_up = [(40.0 + k * 0.05, -99.5) for k in range(1, 5)]
        side_road_down = [(40.0 + k * 0.05 + 0.0005, -99.5) for k in range(3, 0, -1)]
        rest_of_trip = [(40.0, -99.5 + k * 0.1) for k in range(0, 6)]
        coords, seg_mi, seg_s = self.build(main_road + side_road_up + side_road_down + rest_of_trip)
        via_index = len(main_road) + len(side_road_up) - 1

        trimmed, trimmed_mi, trimmed_s = trim_via_spur(coords, seg_mi, seg_s, via_index, min_s_per_mi=60)

        self.assertNotIn(side_road_up[-1], trimmed)
        self.assertAlmostEqual(sum(trimmed_mi), haversine_mi((40.0, -100.0), (40.0, -99.0)), delta=0.5)
        self.assertEqual(len(trimmed_mi), len(trimmed) - 1)
        self.assertEqual(len(trimmed_s), len(trimmed_mi))

    def test_clean_detour_is_unchanged(self):
        up = [(40.0 + k * 0.1, -100 + k * 0.1) for k in range(6)]
        down = [(40.5 - k * 0.1, -99.5 + k * 0.1) for k in range(1, 6)]
        coords, seg_mi, seg_s = self.build(up + down)
        self.assertEqual(trim_via_spur(coords, seg_mi, seg_s, len(up) - 1, 60)[0], coords)


class RouteGeometryTests(SimpleTestCase):
    def test_overlap_ratio(self):
        a = straight_path(100, 50)
        far = straight_path(100, 50, lat=41.0)
        self.assertGreater(overlap_ratio(a, a), 0.99)
        self.assertLess(overlap_ratio(a, far), 0.01)

    def test_corridor_grid_stays_within_budget_and_buffer(self):
        path = straight_path(400, 60)
        grid = build_corridor([path], buffer_mi=35, max_points=200)
        self.assertLessEqual(len(grid.cells), 200)
        self.assertGreater(len(grid.cells), 50)
        for r, c in grid.cells:
            lat, _ = grid.point(r, c)
            self.assertLess(abs(lat - 40.0), 35 / 69 + grid.dlat)
