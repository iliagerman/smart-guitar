"""YAML-based configuration loading with environment overrides.

Loads base.config.yml, then merges environment-specific overrides
(dev.config.yml or prod.config.yml) based on the APP_ENV env var.
When S3 backend is used without IAM roles, AWS credentials are read
from the project-root secrets.yml.
"""

import os
from functools import lru_cache
from pathlib import Path
from typing import Literal, Optional

import yaml
from pydantic import BaseModel

# inference_demucs/ is 3 levels up from this file (src/inference_demucs/config.py)
_PACKAGE_ROOT = Path(__file__).resolve().parent.parent.parent
_CONFIG_DIR = _PACKAGE_ROOT / "config"


class AppConfig(BaseModel):
    name: str = "inference-demucs-api"
    host: str = "0.0.0.0"
    port: int = 8000
    log_level: str = "info"


class DemucsConfig(BaseModel):
    model_name: str = "htdemucs_6s"


class ProcessingConfig(BaseModel):
    temp_dir: str = "/tmp/inference_demucs"
    cleanup_temp: bool = True


class AwsConfig(BaseModel):
    region: str = "us-east-1"
    use_iam_role: bool = True
    secrets_file: Optional[str] = None
    access_key: Optional[str] = None
    secret_key: Optional[str] = None


class StorageConfig(BaseModel):
    backend: Literal["local", "s3"] = "local"
    base_path: Optional[str] = None
    bucket: Optional[str] = None
    output_prefix: str = ""
    create_bucket_if_missing: bool = False


class Settings(BaseModel):
    environment: str = "dev"
    app: AppConfig = AppConfig()
    demucs: DemucsConfig = DemucsConfig()
    processing: ProcessingConfig = ProcessingConfig()
    aws: AwsConfig = AwsConfig()
    storage: StorageConfig = StorageConfig()


def _deep_merge(base: dict, override: dict) -> dict:
    """Recursively merge override into base. Override values win."""
    merged = base.copy()
    for key, value in override.items():
        if key in merged and isinstance(merged[key], dict) and isinstance(value, dict):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


def _resolve_secrets(merged: dict, config_dir: Path) -> dict:
    """Load AWS credentials from secrets.yml when use_iam_role is false and backend is s3."""
    aws_cfg = merged.get("aws", {})
    storage_cfg = merged.get("storage", {})

    if storage_cfg.get("backend") != "s3":
        return merged
    if aws_cfg.get("use_iam_role", True):
        return merged

    secrets_file = aws_cfg.get("secrets_file")
    if secrets_file:
        secrets_path = Path(secrets_file)
        if not secrets_path.is_absolute():
            secrets_path = config_dir / secrets_file
    else:
        # In Docker the layout is flat (/app/config/, /app/secrets.yml) so secrets
        # is one level up.  In local dev there's an extra package directory between
        # the project root and config/, so secrets is two levels up.
        one_up = config_dir.parent / "secrets.yml"
        secrets_path = one_up if one_up.exists() else config_dir.parent.parent / "secrets.yml"

    if secrets_path.exists():
        with open(secrets_path) as f:
            secrets = yaml.safe_load(f) or {}
        aws_secrets = secrets.get("aws", {})
        if "aws" not in merged:
            merged["aws"] = {}
        if "access_key" not in merged["aws"] or merged["aws"]["access_key"] is None:
            merged["aws"]["access_key"] = aws_secrets.get("access_key")
        if "secret_key" not in merged["aws"] or merged["aws"]["secret_key"] is None:
            merged["aws"]["secret_key"] = aws_secrets.get("secret_key")
        if "region" not in merged["aws"] or merged["aws"]["region"] is None:
            merged["aws"]["region"] = aws_secrets.get("region", "us-east-1")

    return merged


def load_settings(app_env: str | None = None, config_dir: Path | None = None) -> Settings:
    """Load and merge config files, resolve secrets, return Settings.

    Args:
        app_env: Environment name. Defaults to APP_ENV env var or "dev".
        config_dir: Path to config directory. Defaults to inference_demucs/config/.
    """
    if app_env is None:
        app_env = os.environ.get("APP_ENV", "dev")
    if config_dir is None:
        config_dir = _CONFIG_DIR

    base_path = config_dir / "base.config.yml"
    env_path = config_dir / f"{app_env}.config.yml"

    base: dict = {}
    if base_path.exists():
        with open(base_path) as f:
            base = yaml.safe_load(f) or {}

    env_override: dict = {}
    if env_path.exists():
        with open(env_path) as f:
            env_override = yaml.safe_load(f) or {}

    merged = _deep_merge(base, env_override)
    merged = _resolve_secrets(merged, config_dir)

    return Settings(**merged)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached singleton for application settings."""
    return load_settings()
