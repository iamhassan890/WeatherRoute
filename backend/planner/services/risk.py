from dataclasses import dataclass
from enum import IntEnum


class Risk(IntEnum):
    LOW = 0
    MODERATE = 1
    HIGH = 2
    SEVERE = 3
    NO_TRAVEL = 4

    @property
    def label(self) -> str:
        return self.name.replace("_", " ").title()


@dataclass(frozen=True)
class Threshold:
    level: Risk
    bound: float
    inclusive: bool = True

    def matches(self, value: float) -> bool:
        return value >= self.bound if self.inclusive else value > self.bound


WIND_MPH = (
    Threshold(Risk.NO_TRAVEL, 55),
    Threshold(Risk.SEVERE, 45),
    Threshold(Risk.HIGH, 35),
    Threshold(Risk.MODERATE, 25),
)
RAIN_IN_HR = (
    Threshold(Risk.NO_TRAVEL, 1.00, inclusive=False),
    Threshold(Risk.SEVERE, 0.50),
    Threshold(Risk.HIGH, 0.25),
    Threshold(Risk.MODERATE, 0.10),
)
SNOW_IN_HR = (
    Threshold(Risk.NO_TRAVEL, 3.0, inclusive=False),
    Threshold(Risk.SEVERE, 2.0),
    Threshold(Risk.HIGH, 1.0),
    Threshold(Risk.MODERATE, 0.5),
)


@dataclass(frozen=True)
class LoadRule:
    min_wind_mph: float
    max_wind_mph: float
    min_load_lb: float
    level: Risk

    def applies(self, wind_mph: float, load_lb: float) -> bool:
        return self.min_wind_mph <= wind_mph < self.max_wind_mph and load_lb > self.min_load_lb


LOAD_RULES = (
    LoadRule(45, 55, 30_000, Risk.NO_TRAVEL),
    LoadRule(35, 45, 40_000, Risk.SEVERE),
)


def classify(value: float, thresholds: tuple[Threshold, ...]) -> Risk:
    for threshold in thresholds:
        if threshold.matches(value):
            return threshold.level
    return Risk.LOW


def wind_risk(wind_mph: float, load_lb: float) -> tuple[Risk, bool]:
    level = classify(wind_mph, WIND_MPH)
    for rule in LOAD_RULES:
        if rule.applies(wind_mph, load_lb) and rule.level > level:
            return rule.level, True
    return level, False


@dataclass(frozen=True)
class Assessment:
    level: Risk
    wind: Risk
    rain: Risk
    snow: Risk
    reasons: tuple[str, ...]


def assess(wind_mph: float, rain_in_hr: float, snow_in_hr: float, load_lb: float) -> Assessment:
    wind, raised_by_load = wind_risk(wind_mph, load_lb)
    rain = classify(rain_in_hr, RAIN_IN_HR)
    snow = classify(snow_in_hr, SNOW_IN_HR)
    level = max(wind, rain, snow)

    reasons: list[str] = []
    if level > Risk.LOW:
        if wind == level:
            load_note = f" with {load_lb:,.0f} lb load" if raised_by_load else ""
            reasons.append(f"Wind {wind_mph:.1f} mph{load_note}")
        if rain == level:
            reasons.append(f"Rain {rain_in_hr:.3f} in/hr")
        if snow == level:
            reasons.append(f"Snow {snow_in_hr:.2f} in/hr")
    return Assessment(level=level, wind=wind, rain=rain, snow=snow, reasons=tuple(reasons))


def thresholds_payload() -> dict:
    def spec(table: tuple[Threshold, ...], unit: str) -> dict:
        ascending = list(reversed(table))
        return {
            "unit": unit,
            "bounds": [t.bound for t in ascending],
            "inclusive": [t.inclusive for t in ascending],
        }

    return {
        "wind": spec(WIND_MPH, "mph"),
        "rain": spec(RAIN_IN_HR, "in/hr"),
        "snow": spec(SNOW_IN_HR, "in/hr"),
        "load_rules": [
            {
                "min_wind_mph": r.min_wind_mph,
                "max_wind_mph": r.max_wind_mph,
                "min_load_lb": r.min_load_lb,
                "level": int(r.level),
            }
            for r in LOAD_RULES
        ],
    }


def levels_payload() -> list[dict]:
    return [{"level": int(r), "key": r.name, "label": r.label} for r in Risk]
