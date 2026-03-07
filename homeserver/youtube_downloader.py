"""Homeserver YouTube downloader — long-polls SQS, downloads, transcodes, uploads to S3.

Runs as a container on the homeserver. Downloads YouTube audio without a proxy
(uses the homeserver's residential IP), transcodes to MP3 CBR 192k, uploads to
S3, and notifies the backend via the admin API.
"""

import json
import logging
import os
import shutil
import subprocess
import tempfile
import time

import boto3
import requests
import watchtower
import yaml
import yt_dlp

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("youtube-downloader")


def _load_config() -> dict:
    """Load merged secrets from /app/config/secrets.yml."""
    config_path = os.environ.get("CONFIG_PATH", "/app/config/secrets.yml")
    with open(config_path) as f:
        return yaml.safe_load(f) or {}


def _get_env(config: dict) -> dict:
    """Extract required settings from merged secrets + env vars."""
    aws = config.get("aws", {})
    admin = config.get("admin", {})
    return {
        "aws_region": os.environ.get("AWS_REGION", aws.get("region", "us-east-1")),
        "aws_access_key_id": os.environ.get("AWS_ACCESS_KEY_ID", aws.get("access_key", "")),
        "aws_secret_access_key": os.environ.get("AWS_SECRET_ACCESS_KEY", aws.get("secret_key", "")),
        "sqs_queue_url": os.environ["SQS_QUEUE_URL"],
        "backend_api_url": os.environ.get("BACKEND_API_URL", "https://api.smart-guitar.com/api/v1"),
        "admin_api_key": os.environ.get("ADMIN_API_KEY", admin.get("api-key", "")),
    }


def download_and_upload(
    youtube_id: str,
    bucket: str,
    target_s3_key: str,
    s3_client,
) -> None:
    """Download YouTube audio, transcode to MP3 CBR 192k, upload to S3."""
    # Check if already exists on S3
    try:
        s3_client.head_object(Bucket=bucket, Key=target_s3_key)
        logger.info("Already on S3: s3://%s/%s — skipping download", bucket, target_s3_key)
        return
    except s3_client.exceptions.ClientError:
        pass

    tmp_dir = tempfile.mkdtemp(prefix="yt_dl_")
    try:
        url = f"https://www.youtube.com/watch?v={youtube_id}"
        raw_output = os.path.join(tmp_dir, "raw.%(ext)s")

        ydl_opts = {
            "format": "bestaudio/best",
            "outtmpl": raw_output,
            "quiet": True,
            "no_warnings": True,
            "postprocessors": [
                {
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": "mp3",
                    "preferredquality": "192",
                }
            ],
            "retries": 5,
            "fragment_retries": 5,
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])

        # Find the downloaded MP3
        mp3_files = [f for f in os.listdir(tmp_dir) if f.endswith(".mp3")]
        if not mp3_files:
            raise FileNotFoundError(f"No MP3 file found after downloading {youtube_id}")

        downloaded_mp3 = os.path.join(tmp_dir, mp3_files[0])

        # Explicit CBR 192k transcode (matches backend's transcode_audio_to_mp3_cbr192)
        output_mp3 = os.path.join(tmp_dir, "audio.mp3")
        subprocess.run(
            [
                "ffmpeg", "-i", downloaded_mp3,
                "-codec:a", "libmp3lame",
                "-b:a", "192k",
                "-ar", "44100",
                "-y", output_mp3,
            ],
            check=True,
            capture_output=True,
            timeout=120,
        )

        # Upload to S3
        s3_client.upload_file(output_mp3, bucket, target_s3_key)
        logger.info("Uploaded to s3://%s/%s", bucket, target_s3_key)

    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def notify_backend(song_id: str, backend_api_url: str, admin_api_key: str) -> None:
    """Notify the backend that audio download is complete."""
    url = f"{backend_api_url}/admin/songs/{song_id}/download-complete"
    resp = requests.post(
        url,
        headers={"Authorization": f"Bearer {admin_api_key}"},
        timeout=30,
    )
    resp.raise_for_status()
    logger.info("Backend notified for song %s: %s", song_id, resp.json())


def main() -> None:
    config = _load_config()
    env = _get_env(config)

    sqs = boto3.client(
        "sqs",
        region_name=env["aws_region"],
        aws_access_key_id=env["aws_access_key_id"],
        aws_secret_access_key=env["aws_secret_access_key"],
    )
    s3 = boto3.client(
        "s3",
        region_name=env["aws_region"],
        aws_access_key_id=env["aws_access_key_id"],
        aws_secret_access_key=env["aws_secret_access_key"],
    )

    # Stream logs to CloudWatch as JSON (matches backend format for Grafana dashboard)
    class _JsonFormatter(logging.Formatter):
        def format(self, record):
            return json.dumps({
                "timestamp": self.formatTime(record),
                "level": record.levelname,
                "logger": record.name,
                "message": record.getMessage(),
                "service": "youtube-downloader",
                "request_id": getattr(record, "request_id", ""),
                "rid": getattr(record, "request_id", ""),
                "user_id": getattr(record, "user_id", ""),
                "user_email": getattr(record, "user_email", ""),
            })

    cw_handler = watchtower.CloudWatchLogHandler(
        log_group_name="/homeserver/smart-guitar-youtube-downloader",
        boto3_client=boto3.client(
            "logs",
            region_name=env["aws_region"],
            aws_access_key_id=env["aws_access_key_id"],
            aws_secret_access_key=env["aws_secret_access_key"],
        ),
    )
    cw_handler.setFormatter(_JsonFormatter())
    logging.getLogger().addHandler(cw_handler)

    # Request context filter — injects request_id/user_id from SQS message into logs
    class _RequestContext(logging.Filter):
        def __init__(self):
            super().__init__()
            self.request_id = ""
            self.user_id = ""
            self.user_email = ""

        def filter(self, record):
            record.request_id = self.request_id
            record.user_id = self.user_id
            record.user_email = self.user_email
            return True

    req_ctx = _RequestContext()
    logging.getLogger().addFilter(req_ctx)

    logger.info("Starting YouTube downloader, polling %s", env["sqs_queue_url"])

    while True:
        try:
            resp = sqs.receive_message(
                QueueUrl=env["sqs_queue_url"],
                MaxNumberOfMessages=1,
                WaitTimeSeconds=20,
            )
            messages = resp.get("Messages", [])

            for msg in messages:
                body = json.loads(msg["Body"])
                youtube_id = body["youtube_id"]
                target_s3_key = body["target_s3_key"]
                bucket = body["bucket"]
                song_id = body.get("song_id")

                # Set request context from SQS message for log correlation
                req_ctx.request_id = body.get("request_id", "")
                req_ctx.user_id = body.get("user_id", "")
                req_ctx.user_email = body.get("user_email", "")

                logger.info(
                    "Processing: yt=%s -> s3://%s/%s (song=%s)",
                    youtube_id, bucket, target_s3_key, song_id,
                )

                try:
                    download_and_upload(youtube_id, bucket, target_s3_key, s3)

                    if song_id:
                        notify_backend(song_id, env["backend_api_url"], env["admin_api_key"])

                except Exception:
                    logger.exception("Failed to process yt=%s", youtube_id)
                    # Message becomes visible again after visibility timeout
                    # and retries up to maxReceiveCount before going to DLQ
                    continue

                # Delete message on success
                sqs.delete_message(
                    QueueUrl=env["sqs_queue_url"],
                    ReceiptHandle=msg["ReceiptHandle"],
                )

        except KeyboardInterrupt:
            logger.info("Shutting down")
            break
        except Exception:
            logger.exception("Error in poll loop; sleeping 10s")
            time.sleep(10)


if __name__ == "__main__":
    main()
