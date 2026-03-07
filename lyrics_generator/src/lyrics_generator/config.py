"""YAML-based configuration loading with environment overrides.

Loads base.config.yml, then merges environment-specific overrides
(local.config.yml or prod.config.yml) based on the APP_ENV env var.
When S3 backend is used without IAM roles, AWS credentials are read
from the project-root secrets.yml.
"""

import os
from functools import lru_cache
from pathlib import Path
from typing import Literal, Optional

import yaml
from pydantic import BaseModel

# lyrics_generator/ is 3 levels up from this file (src/lyrics_generator/config.py)
_PACKAGE_ROOT = Path(__file__).resolve().parent.parent.parent
_CONFIG_DIR = _PACKAGE_ROOT / "config"


class AppConfig(BaseModel):
    name: str = "lyrics_generator-api"
    host: str = "0.0.0.0"
    port: int = 8003
    log_level: str = "info"


class WhisperConfig(BaseModel):
    model_name: str = "base"
    language: str | None = None
    word_timestamps: bool = True
    # CTranslate2 compute type: "int8" is optimal for CPU/Lambda with torch.
    compute_type: str = "int8"
    # Run wav2vec2 forced alignment after transcription for ~50ms word accuracy.
    enable_alignment: bool = True
    # Whisper supports a float or a tuple/list of floats for fallback sampling.
    temperature: float | list[float] = 0.0
    condition_on_previous_text: bool = False
    # Beam search (often improves accuracy on hard audio, at cost of speed).
    beam_size: int | None = None
    # Sampling; only meaningful when temperature > 0.
    best_of: int | None = None
    patience: float | None = None
    # Prompting (can help on lyrics when you have song/artist context).
    initial_prompt: str | None = None
    carry_initial_prompt: bool = False
    # Hallucination / silence heuristics.
    no_speech_threshold: float = 0.6
    logprob_threshold: float = -1.0
    compression_ratio_threshold: float = 2.4


class ProcessingConfig(BaseModel):
    temp_dir: str = "/tmp/lyrics_generator"
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
    create_bucket_if_missing: bool = False


class GeniusConfig(BaseModel):
    access_token: Optional[str] = None


class Settings(BaseModel):
    environment: str = "local"
    app: AppConfig = AppConfig()
    whisper: WhisperConfig = WhisperConfig()
    processing: ProcessingConfig = ProcessingConfig()
    aws: AwsConfig = AwsConfig()
    storage: StorageConfig = StorageConfig()
    genius: GeniusConfig = GeniusConfig()


def _deep_merge(base: dict, override: dict) -> dict:
    """Recursively merge override into base. Override values win."""
    merged = base.copy()
    for key, value in override.items():
        if key in merged and isinstance(merged[key], dict) and isinstance(value, dict):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


def _find_secrets_path(merged: dict, config_dir: Path) -> Path:
    """Resolve the path to secrets.yml."""
    aws_cfg = merged.get("aws", {})
    secrets_file = aws_cfg.get("secrets_file")
    if secrets_file:
        secrets_path = Path(secrets_file)
        if not secrets_path.is_absolute():
            secrets_path = config_dir / secrets_file
        return secrets_path
    # In Docker the layout is flat (/app/config/, /app/secrets.yml) so secrets
    # is one level up.  In local dev there's an extra lyrics_generator/ directory
    # between the project root and config/, so secrets is two levels up.
    # Try the closer path first, fall back to the deeper one.
    one_up = config_dir.parent / "secrets.yml"
    if one_up.exists():
        return one_up
    return config_dir.parent.parent / "secrets.yml"


def _resolve_secrets(merged: dict, config_dir: Path) -> dict:
    """Load secrets from secrets.yml (AWS credentials, Genius API keys, etc.)."""
    secrets_path = _find_secrets_path(merged, config_dir)
    if not secrets_path.exists():
        return merged

    with open(secrets_path) as f:
        secrets = yaml.safe_load(f) or {}

    # AWS credentials (only when using S3 without IAM role)
    aws_cfg = merged.get("aws", {})
    storage_cfg = merged.get("storage", {})
    if storage_cfg.get("backend") == "s3" and not aws_cfg.get("use_iam_role", True):
        aws_secrets = secrets.get("aws", {})
        if "aws" not in merged:
            merged["aws"] = {}
        if "access_key" not in merged["aws"] or merged["aws"]["access_key"] is None:
            merged["aws"]["access_key"] = aws_secrets.get("access_key")
        if "secret_key" not in merged["aws"] or merged["aws"]["secret_key"] is None:
            merged["aws"]["secret_key"] = aws_secrets.get("secret_key")
        if "region" not in merged["aws"] or merged["aws"]["region"] is None:
            merged["aws"]["region"] = aws_secrets.get("region", "us-east-1")

    # Genius API credentials
    genius_secrets = secrets.get("genius", {})
    if genius_secrets:
        if "genius" not in merged:
            merged["genius"] = {}
        if not merged["genius"].get("access_token"):
            val = genius_secrets.get("access_token")
            if val:
                merged["genius"]["access_token"] = val

    return merged


def load_settings(
    app_env: str | None = None, config_dir: Path | None = None
) -> Settings:
    """Load and merge config files, resolve secrets, return Settings.

    Args:
        app_env: Environment name. Defaults to APP_ENV env var or "local".
        config_dir: Path to config directory. Defaults to lyrics_generator/config/.
    """
    if app_env is None:
        app_env = os.environ.get("APP_ENV", "local")
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
