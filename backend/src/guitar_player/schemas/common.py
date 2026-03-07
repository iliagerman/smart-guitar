"""Shared schemas: pagination, health, errors."""

from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: str = "ok"
    environment: str


class ErrorResponse(BaseModel):
    detail: str


class PaginationParams(BaseModel):
    offset: int = 0
    limit: int = 50
