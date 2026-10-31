"""Lambda: runs when a photo lands in s3://<bucket>/uploads/.

Reads the photo, asks Gemini to extract the receipt data, and saves the
result (or the error) to DynamoDB. It never raises on a bad photo, because
S3 would retry the Lambda and burn the free Gemini quota.
"""
import logging
import mimetypes
import os
import urllib.error
from datetime import datetime, timezone
from decimal import Decimal
from urllib.parse import unquote_plus

import boto3
from botocore.exceptions import ClientError

from gemini_client import extract_receipt

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3 = boto3.client("s3")
ssm = boto3.client("ssm")
table = boto3.resource("dynamodb").Table(os.environ["TABLE_NAME"])

MODEL = os.environ["GEMINI_MODEL"]
KEY_PARAM = os.environ["GEMINI_KEY_PARAM"]
MAX_BYTES = 7 * 1024 * 1024
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}

_api_key = None  # cached between invocations of a warm Lambda


def get_api_key():
    global _api_key
    if _api_key is None:
        response = ssm.get_parameter(Name=KEY_PARAM, WithDecryption=True)
        _api_key = response["Parameter"]["Value"]
    return _api_key


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def to_decimal(value):
    """DynamoDB does not accept Python floats."""
    return None if value is None else Decimal(str(value))


def to_dynamo(value):
    """Same, for a whole structure: floats inside lists and dicts become Decimal too."""
    if isinstance(value, float):
        return Decimal(str(value))
    if isinstance(value, list):
        return [to_dynamo(entry) for entry in value]
    if isinstance(value, dict):
        return {key: to_dynamo(entry) for key, entry in value.items()}
    return value


def lambda_handler(event, context):
    for record in event.get("Records", []):
        bucket = record["s3"]["bucket"]["name"]
        key = unquote_plus(record["s3"]["object"]["key"])
        process(bucket, key)


def process(bucket, key):
    receipt_id = os.path.splitext(os.path.basename(key))[0]
    existing = table.get_item(Key={"receiptId": receipt_id}).get("Item")
    if not existing:
        # The API creates the row before it hands out the upload link, so a missing row means the
        # person deleted the receipt in the meantime. Do not spend a Gemini request on it.
        logger.info("Receipt %s was deleted or never registered, skipping", receipt_id)
        return
    if existing.get("status") == "done":
        logger.info("Receipt %s already processed, skipping", receipt_id)
        return

    now = now_iso()
    item = {
        "receiptId": receipt_id,
        "imageKey": key,
        "createdAt": existing.get("createdAt", now),
        "updatedAt": now,
    }
    # The API stored the owner when it issued the upload link. put_item below
    # replaces the whole row, so carry it over or the receipt would disappear
    # from its owner's list.
    if "userId" in existing:
        item["userId"] = existing["userId"]
    try:
        obj = s3.get_object(Bucket=bucket, Key=key)
        if obj["ContentLength"] > MAX_BYTES:
            raise ValueError("Photo is larger than 7 MB")
        mime_type = mimetypes.guess_type(key)[0] or obj.get("ContentType", "")
        if mime_type not in ALLOWED_TYPES:
            raise ValueError(f"Unsupported file type: {mime_type or 'unknown'}")

        data = extract_receipt(obj["Body"].read(), mime_type, get_api_key(), MODEL)
        if data["total"] is None:
            raise ValueError("Could not read a total amount from this photo")

        item.update(
            status="done",
            store=data["store"],
            date=data["date"],
            total=to_decimal(data["total"]),
            currency=data["currency"],
            category=data["category"],
            items=to_dynamo(data["items"]),
        )
    except urllib.error.HTTPError as error:
        details = error.read().decode("utf-8", errors="replace")[:300]
        logger.warning("Gemini HTTP %s (model %s) for %s: %s", error.code, MODEL, key, details)
        message = (
            "Gemini rate limit reached, try again later"
            if error.code == 429
            else f"Gemini error {error.code} (model {MODEL})"
        )
        item.update(status="failed", error=message)
    except ValueError as error:  # expected problems: not a receipt, wrong type, too big
        logger.warning("Rejected %s: %s", key, error)
        item.update(status="failed", error=str(error)[:200])
    except Exception as error:  # noqa: BLE001 - any failure must be saved, not raised
        logger.exception("Failed to process %s", key)
        item.update(status="failed", error=str(error)[:200])

    try:
        # Reading takes a few seconds. If the person deleted the receipt meanwhile, the row is gone and
        # this write must not bring it back (it would be an orphan without an owner).
        table.put_item(Item=item, ConditionExpression="attribute_exists(receiptId)")
    except ClientError as error:
        if error.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise
        logger.info("Receipt %s was deleted while it was being read, result dropped", receipt_id)
        return
    logger.info("Receipt %s -> %s", receipt_id, item["status"])
