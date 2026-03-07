"""Application-level exceptions."""


class NotFoundError(Exception):
    """Raised when a requested resource is not found."""

    def __init__(self, resource: str, identifier: str) -> None:
        self.resource = resource
        self.identifier = identifier
        super().__init__(f"{resource} not found: {identifier}")


class AlreadyExistsError(Exception):
    """Raised when attempting to create a duplicate resource."""

    def __init__(self, resource: str, identifier: str) -> None:
        self.resource = resource
        self.identifier = identifier
        super().__init__(f"{resource} already exists: {identifier}")


class BadRequestError(Exception):
    """Raised when the request is invalid or violates application policy."""

    def __init__(self, message: str) -> None:
        super().__init__(message)


class YoutubeAuthenticationRequiredError(BadRequestError):
    """Raised when YouTube requires fresh authenticated cookies."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
