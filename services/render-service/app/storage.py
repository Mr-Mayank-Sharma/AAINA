"""Object storage helpers — rendered outputs ONLY. Never raw body-scan frames."""
import os
import uuid

import boto3

_s3 = boto3.client(
    "s3",
    endpoint_url=os.environ.get("S3_ENDPOINT", "http://localhost:9000"),
    aws_access_key_id=os.environ.get("S3_ACCESS_KEY", "mirra"),
    aws_secret_access_key=os.environ.get("S3_SECRET_KEY", "mirra_dev_secret"),
    region_name=os.environ.get("S3_REGION", "us-east-1"),
)

RENDER_BUCKET = "mirra-render-outputs"


def upload_render_output(image_bytes: bytes, content_type: str = "image/png") -> str:
    key = f"renders/{uuid.uuid4()}.png"
    _s3.put_object(Bucket=RENDER_BUCKET, Key=key, Body=image_bytes, ContentType=content_type)
    endpoint = os.environ.get("S3_PUBLIC_ENDPOINT", os.environ.get("S3_ENDPOINT", "http://localhost:9000"))
    return f"{endpoint}/{RENDER_BUCKET}/{key}"
