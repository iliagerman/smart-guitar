"""Storage abstraction layer for local filesystem and S3.

Chords outputs (chords.json, chords.lab) are written into the same
directory as the input audio file — the song folder created by inference_demucs.

LocalStorage is used in local dev (no AWS dependency). S3Storage is used in prod.
"""

import logging
import os
import shutil
import tempfile
from pathlib import Path
from typing import Protocol

import boto3
from botocore.exceptions import ClientError

from chords_generator.config import Settings

logger = logging.getLogger(__name__)


class StorageBackend(Protocol):
    """Protocol defining the storage backend interface."""

    def init(self) -> None:
        """Startup: create dirs / buckets as needed."""
        ...

    def resolve_input(self, input_path: str) -> str:
        """Make input available locally for processing. Returns local file path."""
        ...

    def store_outputs(self, local_output_dir: str, input_path: str) -> str:
        """Store output files into the same directory as the input file. Returns output path/prefix."""
        ...

    def file_exists(self, path: str) -> bool:
        """Check if input file exists."""
        ...


class LocalStorage:
    """Filesystem-based storage for local development."""

    def __init__(self, settings: Settings) -> None:
        self._base_path = Path(settings.storage.base_path or "./local_bucket")

    def init(self) -> None:
        self._base_path.mkdir(parents=True, exist_ok=True)
        logger.info("LocalStorage initialized: %s", self._base_path)

    def resolve_input(self, input_path: str) -> str:
        if not os.path.isfile(input_path):
            raise FileNotFoundError(f"Input file not found: {input_path}")
        return input_path

    def store_outputs(self, local_output_dir: str, input_path: str) -> str:
        """Copy output files into the parent directory of input_path."""
        dest = Path(input_path).parent

        for filename in os.listdir(local_output_dir):
            src = os.path.join(local_output_dir, filename)
            if os.path.isfile(src):
                shutil.copy2(src, dest / filename)

        output_path = str(dest)
        logger.info("Stored outputs to: %s", output_path)
        return output_path

    def file_exists(self, path: str) -> bool:
        return os.path.isfile(path)


class S3Storage:
    """S3-backed storage for production."""

    def __init__(self, settings: Settings) -> None:
        self._bucket = settings.storage.bucket or ""
        self._create_bucket = settings.storage.create_bucket_if_missing
        self._region = settings.aws.region
        self._temp_dir = settings.processing.temp_dir

        kwargs: dict = {"region_name": self._region}
        if not settings.aws.use_iam_role:
            kwargs["aws_access_key_id"] = settings.aws.access_key
            kwargs["aws_secret_access_key"] = settings.aws.secret_key

        self._s3 = boto3.client("s3", **kwargs)

    def init(self) -> None:
        try:
            self._s3.head_bucket(Bucket=self._bucket)
            logger.info("S3 bucket exists: %s", self._bucket)
        except ClientError:
            if self._create_bucket:
                logger.info("Creating S3 bucket: %s", self._bucket)
                create_kwargs: dict = {"Bucket": self._bucket}
                if self._region != "us-east-1":
                    create_kwargs["CreateBucketConfiguration"] = {
                        "LocationConstraint": self._region
                    }
                self._s3.create_bucket(**create_kwargs)
            else:
                raise

    def resolve_input(self, s3_key: str) -> str:
        local_dir = tempfile.mkdtemp(dir=self._temp_dir, prefix="input_")
        filename = os.path.basename(s3_key)
        local_path = os.path.join(local_dir, filename)

        logger.info("Downloading s3://%s/%s -> %s", self._bucket, s3_key, local_path)
        self._s3.download_file(self._bucket, s3_key, local_path)
        return local_path

    def store_outputs(self, local_output_dir: str, input_path: str) -> str:
        """Upload output files to the same S3 prefix as the input file."""
        # input_path is an S3 key like "song_name/{youtube_id}.mp3"
        # We want to upload into the parent prefix: "song_name/"
        parent_prefix = "/".join(input_path.split("/")[:-1])
        if parent_prefix:
            parent_prefix += "/"

        for filename in os.listdir(local_output_dir):
            local_path = os.path.join(local_output_dir, filename)
            if os.path.isfile(local_path):
                s3_key = f"{parent_prefix}{filename}"
                logger.info("Uploading %s -> s3://%s/%s", local_path, self._bucket, s3_key)
                self._s3.upload_file(local_path, self._bucket, s3_key)

        output_path = f"s3://{self._bucket}/{parent_prefix.rstrip('/')}"
        logger.info("Stored outputs to: %s", output_path)
        return output_path

    def file_exists(self, s3_key: str) -> bool:
        try:
            self._s3.head_object(Bucket=self._bucket, Key=s3_key)
            return True
        except ClientError:
            return False


def create_storage(settings: Settings) -> StorageBackend:
    """Factory: create the appropriate storage backend from settings."""
    if settings.storage.backend == "local":
        return LocalStorage(settings)
    elif settings.storage.backend == "s3":
        return S3Storage(settings)
    else:
        raise ValueError(f"Unknown storage backend: {settings.storage.backend}")
