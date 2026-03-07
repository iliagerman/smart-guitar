"""Health check endpoint — no auth required."""

from fastapi import APIRouter, Depends

from guitar_player.config import Settings, get_settings
from guitar_player.schemas.common import HealthResponse

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
async def health(settings: Settings = Depends(get_settings)) -> HealthResponse:
    return HealthResponse(environment=settings.environment)
