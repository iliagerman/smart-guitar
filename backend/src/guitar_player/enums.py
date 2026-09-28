"""Shared enumerations used across the application."""

from enum import StrEnum


class PaymentProvider(StrEnum):
    PADDLE = "paddle"
    ALLPAY = "allpay"


class PlanType(StrEnum):
    MONTHLY = "monthly"
    YEARLY = "yearly"


class SongDifficulty(StrEnum):
    EASY = "easy"
    MEDIUM = "medium"
    HARD = "hard"


class SkillLevel(StrEnum):
    BEGINNER = "beginner"
    INTERMEDIATE = "intermediate"
    ADVANCED = "advanced"
