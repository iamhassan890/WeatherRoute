from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler

from .services.errors import ServiceError


def exception_handler(exc, context):
    if isinstance(exc, ServiceError):
        return Response({"detail": exc.message}, status=exc.status)
    return drf_exception_handler(exc, context)
