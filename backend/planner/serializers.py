from datetime import timedelta, timezone as dt_timezone

from django.utils import timezone
from rest_framework import serializers

from .services.geo import haversine_mi
from .services.planner import TripRequest

MAX_DAYS_AHEAD = 10
PAST_GRACE = timedelta(hours=2)


class PointSerializer(serializers.Serializer):
    lat = serializers.FloatField(min_value=-90, max_value=90)
    lon = serializers.FloatField(min_value=-180, max_value=180)
    label = serializers.CharField(required=False, allow_blank=True, max_length=300)


class TripRequestSerializer(serializers.Serializer):
    origin = PointSerializer()
    destination = PointSerializer()
    departure = serializers.DateTimeField(help_text="ISO 8601 with timezone, e.g. 2026-11-08T14:00:00Z")
    load_lb = serializers.FloatField(min_value=0, max_value=200_000)
    interval_mi = serializers.ChoiceField(choices=[10, 25, 50], default=25)

    def validate_departure(self, value):
        value = value.astimezone(dt_timezone.utc).replace(microsecond=0)
        now = timezone.now()
        if value < now - PAST_GRACE:
            raise serializers.ValidationError("Departure time is in the past.")
        if value > now + timedelta(days=MAX_DAYS_AHEAD):
            raise serializers.ValidationError(f"Departure must be within the next {MAX_DAYS_AHEAD} days (forecast range).")
        return value

    def validate(self, attrs):
        origin = (attrs["origin"]["lat"], attrs["origin"]["lon"])
        destination = (attrs["destination"]["lat"], attrs["destination"]["lon"])
        if haversine_mi(origin, destination) < 1:
            raise serializers.ValidationError("Origin and destination must be at least a mile apart.")
        return attrs

    def to_trip(self) -> TripRequest:
        data = self.validated_data
        return TripRequest(
            origin=(data["origin"]["lat"], data["origin"]["lon"]),
            destination=(data["destination"]["lat"], data["destination"]["lon"]),
            departure=data["departure"],
            load_lb=data["load_lb"],
            interval_mi=int(data["interval_mi"]),
        )
