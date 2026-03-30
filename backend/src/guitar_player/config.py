"""YAML-based configuration loading with environment overrides.

Loads base.config.yml, then merges environment-specific overrides
({APP_ENV}.config.yml) based on the APP_ENV env var.

Secrets policy for this repo:
- Do NOT fetch configuration from AWS Secrets Manager.
- Load secrets from the repo-managed YAML files and merge them:
    - secrets.yml (base)
    - {APP_ENV}.secrets.yml (environment overrides; e.g. prod.secrets.yml)

YouTube auth cookies are stored as a companion text file rather than inline YAML:
- {APP_ENV}.youtube-cookies.txt (preferred)
- youtube-cookies.txt (fallback)

Secrets are located in two places depending on runtime:
- In Docker/ECS: files live in the image under config_dir (e.g. /app/config)
- In local dev: files live in the repository root (next to secrets.yml)
"""

import os
from functools import lru_cache
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

import yaml
from pydantic import BaseModel, Field

_PACKAGE_ROOT = Path(__file__).resolve().parent.parent.parent
_CONFIG_DIR = _PACKAGE_ROOT / "config"


class AppConfig(BaseModel):
    name: str = "guitar-player-api"
    host: str = "0.0.0.0"
    port: int = 8002
    log_level: str = "info"
    api_prefix: str = "/api/v1"


class DbConfig(BaseModel):
    url: str | None = None
    pool_size: int = 5
    max_overflow: int = 10
    echo: bool = False


class AwsConfig(BaseModel):
    region: str = "us-east-1"
    use_iam_role: bool = True
    access_key: str | None = None
    secret_key: str | None = None


class AwsLambdasConfig(BaseModel):
    job_orchestrator: str | None = None
    vocals_guitar_stitch: str | None = None
    stale_job_sweeper: str | None = None


class StorageConfig(BaseModel):
    backend: Literal["local", "s3"] = "local"
    base_path: str | None = None
    bucket: str | None = None
    cdn_base_url: str | None = None


class CognitoConfig(BaseModel):
    user_pool_id: str | None = None
    client_id: str | None = None
    region: str = "us-east-1"


class CorsConfig(BaseModel):
    allowed_origins: list[str] = ["http://localhost:5173"]


class PresignedUrlConfig(BaseModel):
    expiry_seconds: int = 900


class LlmModelsConfig(BaseModel):
    name_parsing: str = "us.amazon.nova-2-lite-v1:0"
    lyrics_merging: str | None = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
    strum_patterns: str | None = "us.amazon.nova-2-lite-v1:0"


class ServicesConfig(BaseModel):
    inference_demucs: str = "localhost:8000"
    chords_generator: str = "localhost:8001"
    lyrics_generator: str = "localhost:8003"
    tabs_generator: str = "localhost:8004"


class OpenAIConfig(BaseModel):
    # Prefer env var in all environments.
    api_key: str | None = None
    # Default transcription model. "whisper-1" supports word timestamps via verbose_json.
    transcription_model: str = "whisper-1"
    # If you know the language, setting it improves accuracy.
    transcription_language: str | None = None


class YoutubeConfig(BaseModel):
    proxy: str | None = None
    cookies_file: str | None = None
    # When false, cookies are not used for public video metadata/download requests
    # by default. They are only retried when YouTube explicitly requires auth.
    use_cookies_for_public_videos: bool = False

    # Maximum video duration (in seconds) allowed in keyword search results.
    # Videos longer than this are filtered out. 0 = no limit.
    max_duration_seconds: int = 400

    # PO Token provider support (helps with YouTube bot checks / PO Token enforcement)
    # In production we run a provider sidecar in ECS and point yt-dlp to it.
    po_token_provider_enabled: bool = False
    po_token_provider_base_url: str = "http://127.0.0.1:4416"
    po_token_provider_disable_innertube: bool = False

    # Throttling knobs to reduce rate limiting / bot checks.
    # These are applied only to downloads (not search).
    sleep_requests_seconds: float = 0.75
    sleep_interval_seconds: float = 8.0
    max_sleep_interval_seconds: float = 15.0

    # SQS queue URL for offloading YouTube downloads to the homeserver.
    # When set, download_song() publishes a fire-and-forget SQS message
    # instead of downloading directly. None = download in-process (local dev).
    youtube_download_queue_url: str | None = None


class AdminConfig(BaseModel):
    # Shared secret for the dedicated admin service endpoints.
    # Loaded from secrets.yml: admin.api-key
    api_key: str | None = None

    # Whether to run the startup-wide admin scan.
    # Default is disabled; admin can be invoked on-demand via API/script.
    startup_enabled: bool = False


class PaddleConfig(BaseModel):
    enabled: bool = False
    api_key: str | None = None
    product: str | None = None
    price_monthly: str | None = None
    price_yearly: str | None = None
    webhook_secret: str | None = None
    environment: Literal["sandbox", "production"] = "sandbox"
    client_token: str | None = None


class AllPayConfig(BaseModel):
    enabled: bool = False
    login: str | None = None
    api_key: str | None = None
    api_base: str = "https://allpay.to/app/"
    webhook_url: str | None = None
    success_url: str | None = None
    currency: str = "USD"
    price_monthly: int = 600  # cents
    price_monthly_display: str = "6.00"
    price_yearly: int = 5000  # cents
    price_yearly_display: str = "50.00"
    test_mode: bool = True


class TelegramConfig(BaseModel):
    bot_token: str | None = None
    events_chat_id: str | None = None
    errors_chat_id: str | None = None
    feedback_chat_id: str | None = None
    enabled: bool = False


class TavilyConfig(BaseModel):
    api_key: str | None = None


class GeminiConfig(BaseModel):
    api_key: str | None = None


class ExternalStrumsConfig(BaseModel):
    enabled: bool = True
    fetch_timeout_seconds: float = 15.0
    min_alignment_confidence: float = 0.6


class AnalyticsConfig(BaseModel):
    allowed_emails: list[str] = Field(default_factory=list)


class Settings(BaseModel):
    environment: str = "local"
    app: AppConfig = AppConfig()
    db: DbConfig = DbConfig()
    aws: AwsConfig = AwsConfig()
    lambdas: AwsLambdasConfig = AwsLambdasConfig()
    storage: StorageConfig = StorageConfig()
    cognito: CognitoConfig = CognitoConfig()
    cors: CorsConfig = CorsConfig()
    presigned_url: PresignedUrlConfig = PresignedUrlConfig()
    llm_models: LlmModelsConfig = LlmModelsConfig()
    services: ServicesConfig = ServicesConfig()
    openai: OpenAIConfig = OpenAIConfig()
    youtube: YoutubeConfig = YoutubeConfig()
    admin: AdminConfig = AdminConfig()
    paddle: PaddleConfig = PaddleConfig()
    allpay: AllPayConfig = AllPayConfig()
    telegram: TelegramConfig = TelegramConfig()
    analytics: AnalyticsConfig = AnalyticsConfig()
    external_strums: ExternalStrumsConfig = ExternalStrumsConfig()
    tavily: TavilyConfig = TavilyConfig()
    gemini: GeminiConfig = GeminiConfig()
    subscription_bypass_emails: list[str] = []
    admin_users: list[str] = []


def _deep_merge(base: dict, override: dict) -> dict:
    """Recursively merge override into base. Override values win."""
    merged = base.copy()
    for key, value in override.items():
        if value in (None, ""):
            continue
        if key in merged and isinstance(merged[key], dict) and isinstance(value, dict):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


def _secrets_candidate_names(app_env: str) -> list[str]:
    return [
        f".{app_env}.secrets.yaml",
        f".{app_env}.secrets.yml",
        f"{app_env}.secrets.yaml",
        f"{app_env}.secrets.yml",
        ".secrets.yaml",
        ".secrets.yml",
        "secrets.yaml",
        "secrets.yml",
    ]


def _find_first_existing(directory: Path, names: list[str]) -> Path | None:
    for name in names:
        candidate = directory / name
        if candidate.exists():
            return candidate
    return None


def _find_secrets_file(config_dir: Path, app_env: str) -> Path | None:
    """Locate the secrets file. Checks config_dir first, then project root."""
    # 1. config_dir/{app_env}.secrets.yml  (inside Docker image)
    candidate = _find_first_existing(
        config_dir,
        [
            f".{app_env}.secrets.yaml",
            f".{app_env}.secrets.yml",
            f"{app_env}.secrets.yaml",
            f"{app_env}.secrets.yml",
        ],
    )
    if candidate:
        return candidate

    # 2. project_root/{app_env}.secrets.yml  (local dev)
    project_root = config_dir.parent.parent
    candidate = _find_first_existing(
        project_root,
        [
            f".{app_env}.secrets.yaml",
            f".{app_env}.secrets.yml",
            f"{app_env}.secrets.yaml",
            f"{app_env}.secrets.yml",
        ],
    )
    if candidate:
        return candidate

    # 3. project_root/secrets.yml  (legacy fallback)
    candidate = _find_first_existing(
        project_root,
        [".secrets.yaml", ".secrets.yml", "secrets.yaml", "secrets.yml"],
    )
    if candidate:
        return candidate

    return None


def _project_root_for_config_dir(config_dir: Path) -> Path:
    """Best-effort repo root resolution.

    Locally, config_dir defaults to <repo>/backend/config.
    In Docker, config_dir is typically /app/config.
    """
    # Local layout: <repo>/backend/config
    if config_dir.name == "config" and config_dir.parent.name == "backend":
        return config_dir.parent.parent
    # Docker layout: /app/config
    return config_dir.parent


def _local_backend_root(config_dir: Path) -> Path | None:
    if config_dir.name == "config" and config_dir.parent.name == "backend":
        return config_dir.parent
    return None


def _find_secrets_files(config_dir: Path, app_env: str) -> list[Path]:
    """Locate secrets files (base + env override), returning them in load order."""
    files: list[Path] = []

    # Prefer files baked into the container image (config_dir)
    for candidate in (
        config_dir / ".secrets.yaml",
        config_dir / ".secrets.yml",
        config_dir / "secrets.yaml",
        config_dir / "secrets.yml",
    ):
        if candidate.exists() and candidate not in files:
            files.append(candidate)
    for candidate in (
        config_dir / f".{app_env}.secrets.yaml",
        config_dir / f".{app_env}.secrets.yml",
        config_dir / f"{app_env}.secrets.yaml",
        config_dir / f"{app_env}.secrets.yml",
    ):
        if candidate.exists() and candidate not in files:
            files.append(candidate)

    # Local dev / repo root
    project_root = _project_root_for_config_dir(config_dir)
    for candidate in (
        project_root / ".secrets.yaml",
        project_root / ".secrets.yml",
        project_root / "secrets.yaml",
        project_root / "secrets.yml",
    ):
        if candidate.exists() and candidate not in files:
            files.append(candidate)
    for candidate in (
        project_root / f".{app_env}.secrets.yaml",
        project_root / f".{app_env}.secrets.yml",
        project_root / f"{app_env}.secrets.yaml",
        project_root / f"{app_env}.secrets.yml",
    ):
        if candidate.exists() and candidate not in files:
            files.append(candidate)

    backend_root = _local_backend_root(config_dir)
    if backend_root is not None:
        for candidate in (
            backend_root / ".secrets.yaml",
            backend_root / ".secrets.yml",
            backend_root / f".{app_env}.secrets.yaml",
            backend_root / f".{app_env}.secrets.yml",
            backend_root / f"{app_env}.secrets.yaml",
            backend_root / f"{app_env}.secrets.yml",
        ):
            if candidate.exists() and candidate not in files:
                files.append(candidate)

    # Legacy fallback used by older setups
    legacy = _find_secrets_file(config_dir, app_env)
    if legacy and legacy not in files:
        files.append(legacy)

    return files


def _find_youtube_cookies_file(config_dir: Path, app_env: str) -> Path | None:
    """Locate an environment-specific YouTube cookies file near the secrets files."""
    search_dirs: list[Path] = []

    def add_dir(path: Path) -> None:
        if path not in search_dirs:
            search_dirs.append(path)

    for secrets_path in _find_secrets_files(config_dir, app_env):
        add_dir(secrets_path.parent)

    add_dir(config_dir)
    add_dir(_project_root_for_config_dir(config_dir))

    filenames = [f"{app_env}.youtube-cookies.txt", "youtube-cookies.txt"]
    for directory in search_dirs:
        for filename in filenames:
            candidate = directory / filename
            if candidate.exists() and candidate.is_file():
                return candidate

    return None


def _resolve_secrets(merged: dict, config_dir: Path, app_env: str = "local") -> dict:
    """Load secrets from the secrets file.

    Looks for {app_env}.secrets.yml in config_dir first (Docker),
    then project root (local dev), then falls back to secrets.yml.

    App-level secrets (youtube, paddle, telegram, etc.) are always loaded.
    AWS/DB/Cognito secrets are only loaded when use_iam_role is false
    (in prod these come from AWS Secrets Manager instead).
    """
    secrets_paths = _find_secrets_files(config_dir, app_env)
    print(f"[CONFIG DEBUG] config_dir={config_dir}, app_env={app_env}")
    print(f"[CONFIG DEBUG] secrets_paths={secrets_paths}")
    if not secrets_paths:
        print("[CONFIG DEBUG] No secrets files found!")
        return merged

    def _has_value(value: object) -> bool:
        return isinstance(value, str) and bool(value.strip())

    def _mask_db_url(url: str | None) -> str:
        if not url:
            return "<unset>"
        try:
            parsed = urlparse(url)
            username = parsed.username or "<no-user>"
            hostname = parsed.hostname or "<no-host>"
            port = parsed.port or "<no-port>"
            database = parsed.path.lstrip("/") or "<no-db>"
            scheme = parsed.scheme or "postgresql"
            return f"{scheme}://{username}:***@{hostname}:{port}/{database}"
        except Exception:
            return "<invalid-db-url>"

    secrets: dict = {}
    for secrets_path in secrets_paths:
        with open(secrets_path) as f:
            loaded = yaml.safe_load(f) or {}
        if not isinstance(loaded, dict):
            continue
        loaded_db_url = (
            (loaded.get("db") or {}).get("url")
            if isinstance(loaded.get("db"), dict)
            else None
        )
        loaded_admin_key = (
            (loaded.get("admin") or {}).get("api-key")
            if isinstance(loaded.get("admin"), dict)
            else None
        )
        print(
            "[CONFIG DEBUG] Loaded "
            f"{secrets_path}: db_url={_mask_db_url(loaded_db_url)} admin_api_key_present={_has_value(loaded_admin_key)}"
        )
        secrets = _deep_merge(secrets, loaded)
    merged_db_url = (
        (secrets.get("db") or {}).get("url")
        if isinstance(secrets.get("db"), dict)
        else None
    )
    merged_admin_key = (
        (secrets.get("admin") or {}).get("api-key")
        if isinstance(secrets.get("admin"), dict)
        else None
    )
    print(
        "[CONFIG DEBUG] Merged secrets: "
        f"db_url={_mask_db_url(merged_db_url)} admin_api_key_present={_has_value(merged_admin_key)}"
    )

    # --- AWS/DB/Cognito: load from file in ALL environments ---
    aws_secrets = secrets.get("aws", {})
    if "aws" not in merged:
        merged["aws"] = {}
    if not merged["aws"].get("access_key"):
        merged["aws"]["access_key"] = aws_secrets.get("access_key")
    if not merged["aws"].get("secret_key"):
        merged["aws"]["secret_key"] = aws_secrets.get("secret_key")
    if not merged["aws"].get("region"):
        merged["aws"]["region"] = aws_secrets.get("region", "us-east-1")

    db_secrets = secrets.get("db", {})
    if "db" not in merged:
        merged["db"] = {}
    if not merged["db"].get("url"):
        merged["db"]["url"] = db_secrets.get("url")

    cognito_secrets = secrets.get("cognito", {})
    if "cognito" not in merged:
        merged["cognito"] = {}
    if not merged["cognito"].get("user_pool_id"):
        merged["cognito"]["user_pool_id"] = cognito_secrets.get("user_pool_id")
    if not merged["cognito"].get("client_id"):
        merged["cognito"]["client_id"] = cognito_secrets.get("client_id")

    # --- App-level secrets: always loaded ---

    # OpenAI (optional)
    openai_secrets = secrets.get("openai", {})
    if "openai" not in merged:
        merged["openai"] = {}
    if not merged["openai"].get("api_key"):
        merged["openai"]["api_key"] = openai_secrets.get("api_key")

    # Admin service (optional)
    # YAML key uses hyphenated form: admin.api-key
    admin_secrets = secrets.get("admin", {})
    if "admin" not in merged:
        merged["admin"] = {}
    if not merged["admin"].get("api_key"):
        merged["admin"]["api_key"] = admin_secrets.get("api-key")
    admin_key = merged.get("admin", {}).get("api_key")
    print(f"[CONFIG DEBUG] Final admin.api_key present={_has_value(admin_key)}")

    # Paddle (optional)
    # YAML key uses hyphenated form: paddle.api-key, paddle.webhook-secret
    paddle_secrets = secrets.get("paddle", {})
    if "paddle" not in merged:
        merged["paddle"] = {}
    if not merged["paddle"].get("api_key"):
        merged["paddle"]["api_key"] = paddle_secrets.get("api-key")
    if not merged["paddle"].get("webhook_secret"):
        merged["paddle"]["webhook_secret"] = paddle_secrets.get("webhook-secret")

    # AllPay (optional)
    allpay_secrets = secrets.get("allpay", {})
    if "allpay" not in merged:
        merged["allpay"] = {}
    if not merged["allpay"].get("login"):
        merged["allpay"]["login"] = allpay_secrets.get("login")
    if not merged["allpay"].get("api_key"):
        merged["allpay"]["api_key"] = allpay_secrets.get(
            "api_key"
        ) or allpay_secrets.get("api-key")
    if allpay_secrets.get("enabled") is not None:
        merged["allpay"]["enabled"] = allpay_secrets.get("enabled")

    # Telegram (optional)
    # YAML key uses hyphenated form: telegram.bot-token
    telegram_secrets = secrets.get("telegram", {})
    if "telegram" not in merged:
        merged["telegram"] = {}
    if not merged["telegram"].get("bot_token"):
        merged["telegram"]["bot_token"] = telegram_secrets.get("bot-token")

    # Tavily (optional) — also check common typo "tavili"
    tavily_secrets = secrets.get("tavily", {}) or secrets.get("tavili", {})
    if "tavily" not in merged:
        merged["tavily"] = {}
    if not merged["tavily"].get("api_key"):
        merged["tavily"]["api_key"] = tavily_secrets.get("api_key") or tavily_secrets.get("api-key")

    # YouTube proxy (optional)
    youtube_secrets = secrets.get("youtube", {})
    if "youtube" not in merged:
        merged["youtube"] = {}
    if not merged["youtube"].get("proxy"):
        merged["youtube"]["proxy"] = youtube_secrets.get("proxy")
    if not merged["youtube"].get("cookies_file"):
        merged["youtube"]["cookies_file"] = youtube_secrets.get(
            "cookies_file"
        ) or youtube_secrets.get("cookies-file")

    if not merged["youtube"].get("cookies_file"):
        cookies_file = _find_youtube_cookies_file(config_dir, app_env)
        if cookies_file:
            merged["youtube"]["cookies_file"] = str(cookies_file)

    # Gemini (optional)
    gemini_secrets = secrets.get("gemini", {})
    if "gemini" not in merged:
        merged["gemini"] = {}
    if not merged["gemini"].get("api_key"):
        merged["gemini"]["api_key"] = gemini_secrets.get("api_key") or gemini_secrets.get("api-key")

    # Env vars should always win (works locally + ECS task env).
    env_api_key = os.environ.get("OPENAI_API_KEY")
    if env_api_key:
        if "openai" not in merged:
            merged["openai"] = {}
        merged["openai"]["api_key"] = env_api_key

    env_gemini_key = os.environ.get("GEMINI_API_KEY")
    if env_gemini_key:
        if "gemini" not in merged:
            merged["gemini"] = {}
        merged["gemini"]["api_key"] = env_gemini_key

    return merged


def _resolve_env_overrides(merged: dict) -> dict:
    """Override config values from environment variables (set by ECS task definition)."""
    # Database URL override (works for Lambda + ECS).
    db_url = (
        os.environ.get("DATABASE_URL")
        or os.environ.get("DB_URL")
        or os.environ.get("GUITAR_PLAYER_DB_URL")
    )
    if db_url:
        merged.setdefault("db", {})["url"] = db_url

    cognito_pool = os.environ.get("COGNITO_USER_POOL_ID")
    if cognito_pool:
        merged.setdefault("cognito", {})["user_pool_id"] = cognito_pool

    cognito_client = os.environ.get("COGNITO_CLIENT_ID")
    if cognito_client:
        merged.setdefault("cognito", {})["client_id"] = cognito_client

    youtube_proxy = os.environ.get("YOUTUBE_PROXY")
    if youtube_proxy:
        merged.setdefault("youtube", {})["proxy"] = youtube_proxy

    youtube_cookies_file = os.environ.get("YOUTUBE_COOKIES_FILE")
    if youtube_cookies_file:
        merged.setdefault("youtube", {})["cookies_file"] = youtube_cookies_file

    youtube_download_queue_url = os.environ.get("YOUTUBE_DOWNLOAD_QUEUE_URL")
    if youtube_download_queue_url:
        merged.setdefault("youtube", {})["youtube_download_queue_url"] = (
            youtube_download_queue_url
        )

    # Lambda function names/ARNs (used by backend dispatch + orchestrator sub-invocations).
    job_orchestrator = os.environ.get("JOB_ORCHESTRATOR_FUNCTION_NAME")
    if job_orchestrator:
        merged.setdefault("lambdas", {})["job_orchestrator"] = job_orchestrator

    stitch_fn = os.environ.get("VOCALS_GUITAR_STITCH_FUNCTION_NAME")
    if stitch_fn:
        merged.setdefault("lambdas", {})["vocals_guitar_stitch"] = stitch_fn

    sweeper_fn = os.environ.get("STALE_JOB_SWEEPER_FUNCTION_NAME")
    if sweeper_fn:
        merged.setdefault("lambdas", {})["stale_job_sweeper"] = sweeper_fn

    return merged


def load_settings(
    app_env: str | None = None, config_dir: Path | None = None
) -> Settings:
    """Load and merge config files, resolve secrets, return Settings.

    Args:
        app_env: Environment name. Defaults to APP_ENV env var or "local".
        config_dir: Path to config directory. Defaults to backend/config/.
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
    merged = _resolve_secrets(merged, config_dir, app_env)
    merged = _resolve_env_overrides(merged)

    return Settings(**merged)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached singleton for application settings."""
    return load_settings()
