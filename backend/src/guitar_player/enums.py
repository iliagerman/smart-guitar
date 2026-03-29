"""Shared enumerations used across the application."""

from enum import StrEnum


class PaymentProvider(StrEnum):
    PADDLE = "paddle"
    ALLPAY = "allpay"
