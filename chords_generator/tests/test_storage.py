"""S3 storage keeps no downloaded inputs around after a request."""

import os

import boto3
from moto import mock_aws

from chords_generator.config import get_settings
from chords_generator.storage import S3Storage


@mock_aws
def test_release_inputs_deletes_downloaded_copies(tmp_path):
    settings = get_settings().model_copy(deep=True)
    settings.storage.bucket = "songs"
    settings.aws.use_iam_role = True
    settings.processing.temp_dir = str(tmp_path)
    boto3.client("s3", region_name=settings.aws.region).create_bucket(Bucket="songs")
    boto3.client("s3", region_name=settings.aws.region).put_object(Bucket="songs", Key="a/b/bass.mp3", Body=b"x")
    storage = S3Storage(settings)

    local = storage.resolve_input("a/b/bass.mp3")
    assert os.path.isfile(local)

    storage.release_inputs()

    assert not os.path.exists(local)
    assert os.listdir(tmp_path) == []
