"""Song service package -- re-exports SongService for backward compatibility."""

from .core import SongService
from .helpers import STEM_DEFINITIONS, STEM_NAMES

__all__ = ["SongService", "STEM_DEFINITIONS", "STEM_NAMES"]
