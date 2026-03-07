"""Storage abstraction layer for local filesystem and S3.

LocalStorage is used in local dev. S3Storage is used in prod with
presigned URLs for secure client-side access.
"""

import json
import logging
import os
import shutil
from pathlib import Path
from typing import Protocol

import boto3
from botocore.config import Config as BotoConfig
from botocore.exceptions import ClientError

from guitar_player.config import Settings

logger = logging.getLogger(__name__)


class StorageBackend(Protocol):
    """Protocol defining the storage backend interface."""

    def init(self) -> None: ...
    def upload_file(self, local_path: str, key: str) -> str: ...
    def download_to_local(self, key: str, local_path: str) -> str: ...
    def file_exists(self, key: str) -> bool: ...
    def get_url(self, key: str) -> str: ...
    def list_files(self, prefix: str) -> list[str]: ...
    def delete_file(self, key: str) -> bool: ...
    def delete_prefix(self, prefix: str) -> int: ...
    def read_json(self, key: str) -> dict | list: ...
    def resolve_service_path(self, key: str) -> str: ...


class LocalStorage:
    """Filesystem-based storage for local development."""

    def __init__(self, settings: Settings) -> None:
        self._base_path = Path(settings.storage.base_path or "./local_bucket")

    def init(self) -> None:
        self._base_path.mkdir(parents=True, exist_ok=True)
        logger.info("LocalStorage initialized: %s", self._base_path)

    def upload_file(self, local_path: str, key: str) -> str:
        dest = self._base_path / key
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(local_path, dest)
        logger.info("Uploaded %s -> %s", local_path, dest)
        return str(dest)

    def download_to_local(self, key: str, local_path: str) -> str:
        src = self._base_path / key
        if not src.is_file():
            raise FileNotFoundError(f"File not found in storage: {key}")
        Path(local_path).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, local_path)
        return local_path

    def file_exists(self, key: str) -> bool:
        return (self._base_path / key).is_file()

    def get_url(self, key: str) -> str:
        return str((self._base_path / key).resolve())

    def list_files(self, prefix: str) -> list[str]:
        base = self._base_path / prefix
        if not base.is_dir():
            return []
        return [
            f"{prefix}/{f.name}"
            for f in base.iterdir()
            if f.is_file()
        ]

    def delete_file(self, key: str) -> bool:
        path = self._base_path / key
        if path.is_file():
            path.unlink()
            return True
        return False

    def delete_prefix(self, prefix: str) -> int:
        base = self._base_path / prefix
        if not base.is_dir():
            return 0
        count = sum(1 for f in base.rglob("*") if f.is_file())
        shutil.rmtree(base)
        return count

    def resolve_service_path(self, key: str) -> str:
        return str((self._base_path / key).resolve())

    def read_json(self, key: str) -> dict | list:
        path = self._base_path / key
        with open(path) as f:
            return json.load(f)


class S3Storage:
    """S3-backed storage for production."""

    def __init__(self, settings: Settings) -> None:
        self._bucket = settings.storage.bucket or ""
        self._region = settings.aws.region
        self._expiry = settings.presigned_url.expiry_seconds

        kwargs: dict = {
            "region_name": self._region,
            # Force SigV4 — required for presigned URLs with non-ASCII S3 keys
            # (us-east-1 may default to SigV2 which mishandles Unicode paths).
            "config": BotoConfig(signature_version="s3v4"),
        }
        if not settings.aws.use_iam_role:
            kwargs["aws_access_key_id"] = settings.aws.access_key
            kwargs["aws_secret_access_key"] = settings.aws.secret_key

        self._s3 = boto3.client("s3", **kwargs)

    def init(self) -> None:
        try:
            self._s3.head_bucket(Bucket=self._bucket)
            logger.info("S3 bucket exists: %s", self._bucket)
        except ClientError:
            raise

    def upload_file(self, local_path: str, key: str) -> str:
        logger.info("Uploading %s -> s3://%s/%s", local_path, self._bucket, key)
        self._s3.upload_file(local_path, self._bucket, key)
        return f"s3://{self._bucket}/{key}"

    def download_to_local(self, key: str, local_path: str) -> str:
        Path(local_path).parent.mkdir(parents=True, exist_ok=True)
        logger.info("Downloading s3://%s/%s -> %s", self._bucket, key, local_path)
        self._s3.download_file(self._bucket, key, local_path)
        return local_path

    def file_exists(self, key: str) -> bool:
        try:
            self._s3.head_object(Bucket=self._bucket, Key=key)
            return True
        except ClientError:
            return False

    def get_url(self, key: str) -> str:
        return self._s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": self._bucket, "Key": key},
            ExpiresIn=self._expiry,
        )

    def list_files(self, prefix: str) -> list[str]:
        keys: list[str] = []
        paginator = self._s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self._bucket, Prefix=prefix):
            for obj in page.get("Contents", []):
                keys.append(obj["Key"])
        return keys

    def delete_file(self, key: str) -> bool:
        if not self.file_exists(key):
            return False
        self._s3.delete_object(Bucket=self._bucket, Key=key)
        return True

    def delete_prefix(self, prefix: str) -> int:
        keys = self.list_files(prefix)
        if not keys:
            return 0
        deleted = 0
        for i in range(0, len(keys), 1000):
            batch = keys[i : i + 1000]
            self._s3.delete_objects(
                Bucket=self._bucket,
                Delete={"Objects": [{"Key": k} for k in batch], "Quiet": True},
            )
            deleted += len(batch)
        return deleted

    def resolve_service_path(self, key: str) -> str:
        return key

    def read_json(self, key: str) -> dict | list:
        resp = self._s3.get_object(Bucket=self._bucket, Key=key)
        return json.loads(resp["Body"].read())


def create_storage(settings: Settings) -> StorageBackend:
    """Factory: create the appropriate storage backend from settings."""
    if settings.storage.backend == "local":
        return LocalStorage(settings)
    elif settings.storage.backend == "s3":
        return S3Storage(settings)
    else:
        raise ValueError(f"Unknown storage backend: {settings.storage.backend}")
