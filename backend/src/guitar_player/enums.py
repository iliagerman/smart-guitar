"""Shared enumerations used across the application."""

from enum import Enum


class PaymentProvider(str, Enum):
    PADDLE = "paddle"
    ALLPAY = "allpay"
