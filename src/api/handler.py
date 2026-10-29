"""Lambda behind API Gateway (HTTP API, payload format 2.0).

POST /upload-url  -> creates a receipt record and returns a temporary link the
                     browser uses to upload the photo straight to S3.
GET  /receipts    -> returns the saved receipts, newest first.

Both routes need a Cognito sign-in token. API Gateway verifies the token before
this code runs; we only read who the user is from it, and every receipt is
stored with, and listed by, that user's id.
"""
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key
from botocore.config import Config

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Without addressing_style="virtual", boto3 signs URLs for the global
# s3.amazonaws.com host. For a new bucket outside us-east-1 that host answers
# with a redirect, and the browser upload fails. This gives the regional host.
s3 = boto3.client(
    "s3",
    region_name=os.environ["AWS_REGION"],
    config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}),
)
table = boto3.resource("dynamodb").Table(os.environ["TABLE_NAME"])
BUCKET = os.environ["BUCKET_NAME"]
INDEX_NAME = os.environ["INDEX_NAME"]  # lists receipts by owner, newest first

TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
URL_TTL_SECONDS = 300
MAX_ITEMS = 200
PUBLIC_FIELDS = (
    "receiptId", "status", "createdAt", "store",
    "date", "total", "currency", "category", "error",
)


def json_default(value):
    """DynamoDB returns numbers as Decimal, which json cannot print."""
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    raise TypeError(f"Cannot serialize {type(value)}")


def respond(status, body):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body, default=json_default),
    }


def get_user_id(event):
    """The user's id: the "sub" claim of the token API Gateway already verified."""
    context = event.get("requestContext") or {}
    claims = ((context.get("authorizer") or {}).get("jwt") or {}).get("claims") or {}
    return claims.get("sub")


def lambda_handler(event, context):
    route = event.get("routeKey")
    try:
        user_id = get_user_id(event)
        if not user_id:
            # Should be impossible: the routes require a token. If someone ever
            # removes the authorizer, refuse instead of leaking everyone's data.
            return respond(401, {"error": "Unauthorized"})

        if route == "POST /upload-url":
            return create_upload_url(event, user_id)
        if route == "GET /receipts":
            return list_receipts(user_id)
        return respond(404, {"error": "Not found"})
    except Exception:  # noqa: BLE001 - never leak internals to the client
        logger.exception("Unhandled error on %s", route)
        return respond(500, {"error": "Internal error"})


def create_upload_url(event, user_id):
    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return respond(400, {"error": "Body must be valid JSON"})
    if not isinstance(body, dict):
        return respond(400, {"error": "Body must be a JSON object"})

    content_type = body.get("contentType", "image/jpeg")
    if content_type not in TYPES:
        allowed = ", ".join(TYPES)
        return respond(400, {"error": f"contentType must be one of: {allowed}"})

    receipt_id = uuid.uuid4().hex
    key = f"uploads/{receipt_id}.{TYPES[content_type]}"
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")

    # The site can show the receipt as "processing" right away.
    table.put_item(Item={
        "receiptId": receipt_id,
        "userId": user_id,
        "status": "processing",
        "imageKey": key,
        "createdAt": now,
        "updatedAt": now,
    })
    upload_url = s3.generate_presigned_url(
        "put_object",
        Params={"Bucket": BUCKET, "Key": key, "ContentType": content_type},
        ExpiresIn=URL_TTL_SECONDS,
    )
    return respond(200, {
        "receiptId": receipt_id,
        "uploadUrl": upload_url,
        "contentType": content_type,
        "expiresIn": URL_TTL_SECONDS,
    })


def list_receipts(user_id):
    # Only this user's rows; the index is sorted by createdAt, so newest first.
    query_args = {
        "IndexName": INDEX_NAME,
        "KeyConditionExpression": Key("userId").eq(user_id),
        "ScanIndexForward": False,
        "Limit": MAX_ITEMS,
    }
    items = []
    while len(items) < MAX_ITEMS:
        page = table.query(**query_args)
        items.extend(page.get("Items", []))
        if "LastEvaluatedKey" not in page:
            break
        query_args["ExclusiveStartKey"] = page["LastEvaluatedKey"]

    receipts = [
        {field: item[field] for field in PUBLIC_FIELDS if field in item}
        for item in items[:MAX_ITEMS]
    ]
    return respond(200, {"receipts": receipts, "count": len(receipts)})
