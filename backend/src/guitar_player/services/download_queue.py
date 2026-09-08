"""Publish audio downloads to the residential homeserver worker."""

import asyncio
import json
import logging
import uuid

import boto3

from guitar_player.config import get_settings
from guitar_player.request_context import request_id_var, user_email_var, user_id_var

logger = logging.getLogger(__name__)


async def publish_download_request(
    youtube_id: str,
    target_s3_key: str,
    song_id: uuid.UUID,
    sqs_queue_url: str,
) -> None:
    """Publish only after the song and its destination key have been committed."""
    settings = get_settings()
    sqs = boto3.client("sqs", region_name=settings.aws.region)
    message = {
        "youtube_id": youtube_id,
        "target_s3_key": target_s3_key,
        "bucket": settings.storage.bucket,
        "song_id": str(song_id),
        "request_id": request_id_var.get(),
        "user_id": user_id_var.get(),
        "user_email": user_email_var.get(),
    }
    await asyncio.to_thread(
        sqs.send_message,
        QueueUrl=sqs_queue_url,
        MessageBody=json.dumps(message),
    )
    logger.info(
        "Published SQS download request for yt=%s -> %s",
        youtube_id,
        target_s3_key,
    )
