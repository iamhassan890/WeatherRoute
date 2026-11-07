from django.test import SimpleTestCase

from planner.services.risk import RAIN_IN_HR, SNOW_IN_HR, WIND_MPH, Risk, assess, classify

L, M, H, S, N = Risk.LOW, Risk.MODERATE, Risk.HIGH, Risk.SEVERE, Risk.NO_TRAVEL


class ThresholdTableTests(SimpleTestCase):
    def assert_bands(self, table, cases):
        for value, expected in cases:
            with self.subTest(value=value):
                self.assertEqual(classify(value, table), expected)

    def test_wind_bands(self):
        self.assert_bands(
            WIND_MPH,
            [(0, L), (24.9, L), (25, M), (34.9, M), (35, H), (44.9, H), (45, S), (54.9, S), (55, N), (80, N)],
        )

    def test_rain_bands(self):
        self.assert_bands(
            RAIN_IN_HR,
            [(0, L), (0.09, L), (0.10, M), (0.24, M), (0.25, H), (0.49, H), (0.50, S), (1.00, S), (1.01, N)],
        )

    def test_snow_bands(self):
        self.assert_bands(
            SNOW_IN_HR,
            [(0, L), (0.49, L), (0.5, M), (0.99, M), (1.0, H), (1.99, H), (2.0, S), (3.0, S), (3.01, N)],
        )


class LoadRuleTests(SimpleTestCase):
    def level(self, wind, load):
        return assess(wind, 0, 0, load).level

    def test_55_mph_is_no_travel_for_any_load(self):
        self.assertEqual(self.level(55, 0), N)

    def test_45_to_54_mph_over_30k_lb_is_no_travel(self):
        self.assertEqual(self.level(45, 30_001), N)
        self.assertEqual(self.level(54.9, 45_000), N)
        self.assertEqual(self.level(50, 30_000), S)

    def test_35_to_44_mph_over_40k_lb_is_severe(self):
        self.assertEqual(self.level(35, 40_001), S)
        self.assertEqual(self.level(44.9, 80_000), S)
        self.assertEqual(self.level(40, 40_000), H)

    def test_load_rules_do_not_apply_to_lower_wind(self):
        self.assertEqual(self.level(34.9, 80_000), M)

    def test_reason_mentions_load_when_rule_applies(self):
        result = assess(40, 0, 0, 42_000)
        self.assertEqual(result.reasons, ("Wind 40.0 mph with 42,000 lb load",))

    def test_reason_does_not_round_into_the_next_band(self):
        result = assess(44.8, 0, 0, 0)
        self.assertEqual(result.level, H)
        self.assertEqual(result.reasons, ("Wind 44.8 mph",))


class OverallAssessmentTests(SimpleTestCase):
    def test_overall_level_is_worst_factor(self):
        result = assess(wind_mph=26, rain_in_hr=0.3, snow_in_hr=0.0, load_lb=10_000)
        self.assertEqual((result.wind, result.rain, result.snow), (M, H, L))
        self.assertEqual(result.level, H)
        self.assertEqual(result.reasons, ("Rain 0.300 in/hr",))

    def test_ties_list_every_factor_at_the_worst_level(self):
        result = assess(wind_mph=46, rain_in_hr=0.0, snow_in_hr=2.5, load_lb=0)
        self.assertEqual(result.level, S)
        self.assertEqual(len(result.reasons), 2)

    def test_calm_weather_is_low_with_no_reasons(self):
        result = assess(5, 0, 0, 80_000)
        self.assertEqual(result.level, L)
        self.assertEqual(result.reasons, ())
