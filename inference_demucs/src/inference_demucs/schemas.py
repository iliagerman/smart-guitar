"""Pydantic request/response models for the API."""

from typing import Optional

from pydantic import BaseModel, Field


class SeparateRequest(BaseModel):
    input_path: str = Field(..., min_length=1, description="Local file path (dev) or S3 key (prod)")
    requested_outputs: Optional[list[str]] = Field(
        None,
        description="Which outputs to produce. Options: guitar_isolated, vocals_isolated, "
        "guitar_removed, vocals_removed. Defaults to all four.",
    )


class StemInfo(BaseModel):
    name: str
    path: str


class SeparateResponse(BaseModel):
    status: str = "done"
    output_path: str
    stems: list[StemInfo]
    input_path: str


class ErrorResponse(BaseModel):
    status: str = "error"
    detail: str
