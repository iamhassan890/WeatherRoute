from rest_framework.response import Response
from rest_framework.views import APIView

from .serializers import TripRequestSerializer
from .services import geocoding, heatmap, planner

MAX_QUERY_LENGTH = 200
MIN_QUERY_LENGTH = 2


class HealthView(APIView):
    throttle_classes: list = []

    def get(self, request):
        return Response({"status": "ok"})


class GeocodeView(APIView):
    throttle_scope = "geocode"

    def get(self, request):
        query = request.query_params.get("q", "").strip()[:MAX_QUERY_LENGTH]
        if len(query) < MIN_QUERY_LENGTH:
            return Response({"results": []})
        return Response({"results": geocoding.search(query)})


class PlanView(APIView):
    throttle_scope = "plan"

    def post(self, request):
        serializer = TripRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(planner.plan_trip(serializer.to_trip()))


class HeatmapView(APIView):
    throttle_scope = "plan"

    def post(self, request):
        serializer = TripRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(heatmap.build_heatmap(serializer.to_trip()))
