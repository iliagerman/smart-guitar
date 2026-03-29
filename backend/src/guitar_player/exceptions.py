"""Application-level exceptions and HTTP helper utilities."""

from typing import TypeVar

T = TypeVar("T")


class AppException(Exception):
    """Base exception for all application-level errors.

    Subclasses map to specific HTTP status codes via exception handlers
    registered in main.py.
    """


class NotFoundError(AppException):
    """Raised when a requested resource is not found. Maps to HTTP 404."""

    def __init__(self, resource: str, identifier: str) -> None:
        self.resource = resource
        self.identifier = identifier
        super().__init__(f"{resource} not found: {identifier}")


class AlreadyExistsError(AppException):
    """Raised when attempting to create a duplicate resource. Maps to HTTP 409."""

    def __init__(self, resource: str, identifier: str) -> None:
        self.resource = resource
        self.identifier = identifier
        super().__init__(f"{resource} already exists: {identifier}")


class BadRequestError(AppException):
    """Raised when the request is invalid or violates application policy. Maps to HTTP 400."""

    def __init__(self, message: str) -> None:
        super().__init__(message)


class YoutubeAuthenticationRequiredError(BadRequestError):
    """Raised when YouTube requires fresh authenticated cookies."""

    def __init__(self, message: str) -> None:
        super().__init__(message)


class ServiceUnavailableError(AppException):
    """Raised when an external service is temporarily unavailable. Maps to HTTP 503."""

    def __init__(self, message: str) -> None:
        super().__init__(message)


class ForbiddenError(AppException):
    """Raised when the user lacks permission. Maps to HTTP 403."""

    def __init__(self, message: str = "Access denied") -> None:
        super().__init__(message)


def get_or_404(result: T | None, resource: str) -> T:
    """Return *result* if not None, otherwise raise NotFoundError.

    Usage in routers::

        song = await song_service.get_by_id(db, song_id)
        return get_or_404(song, "Song")
    """
    if result is None:
        raise NotFoundError(resource, "not found")
    return result


def require(condition: bool, message: str) -> None:
    """Raise BadRequestError if *condition* is falsy.

    Usage in routers::

        require(len(name) <= 255, "Name must be 255 characters or fewer")
    """
    if not condition:
        raise BadRequestError(message)
