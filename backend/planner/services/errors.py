class ServiceError(Exception):
    status = 502

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class UpstreamUnavailable(ServiceError):
    status = 503


class NoRouteFound(ServiceError):
    status = 422
