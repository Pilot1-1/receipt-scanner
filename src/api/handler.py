"""Lambda behind API Gateway (HTTP API, payload format 2.0).

POST   /upload-url           -> creates a receipt record and returns a temporary link the
                                browser uses to upload the photo straight to S3.
GET    /receipts             -> returns the saved receipts, newest first.
GET    /receipts/{id}/image  -> returns a temporary link to the original photo.
PATCH  /receipts/{id}        -> corrects store, date, total, currency or category by hand.
DELETE /receipts/{id}        -> deletes the receipt and its photo.
GET    /budgets              -> returns the user's monthly limits per category.
PUT    /budgets              -> sets the limits of one currency.

Every route needs a Cognito sign-in token. API Gateway verifies the token before
this code runs; we only read who the user is from it, and every receipt is
stored with, and looked up by, that user's id. A receipt that belongs to someone
else looks exactly like a receipt that does not exist (404).
"""
import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key
from botocore.config import Config
from botocore.exceptions import ClientError

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
dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(os.environ["TABLE_NAME"])
budgets_table = dynamodb.Table(os.environ["BUDGETS_TABLE"])
BUCKET = os.environ["BUCKET_NAME"]
INDEX_NAME = os.environ["INDEX_NAME"]  # lists receipts by owner, newest first

TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
CATEGORIES = ("food", "groceries", "transport", "shopping", "health", "entertainment", "bills", "other")
URL_TTL_SECONDS = 300
MAX_ITEMS = 200
MAX_AMOUNT = 1_000_000_000
PUBLIC_FIELDS = (
    "receiptId", "status", "createdAt", "store",
    "date", "total", "currency", "category", "items", "error", "edited",
)
EDITABLE_FIELDS = ("store", "date", "total", "currency", "category")

RECEIPT_ID = re.compile(r"[0-9a-f]{32}")  # uuid4().hex
DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
CURRENCY = re.compile(r"[A-Z]{3}")


def json_default(value):
    """DynamoDB returns numbers as Decimal, which json cannot print."""
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    raise TypeError(f"Cannot serialize {type(value)}")


def respond(status, body):
    return {
        "statusCode": status,
        # Responses contain temporary links and private data: never cache them.
        "headers": {"Content-Type": "application/json", "Cache-Control": "no-store"},
        "body": json.dumps(body, default=json_default),
    }


def get_user_id(event):
    """The user's id: the "sub" claim of the token API Gateway already verified."""
    context = event.get("requestContext") or {}
    claims = ((context.get("authorizer") or {}).get("jwt") or {}).get("claims") or {}
    return claims.get("sub")


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def read_body(event):
    """Returns (body, None) for a JSON object, or (None, error response)."""
    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return None, respond(400, {"error": "Body must be valid JSON"})
    if not isinstance(body, dict):
        return None, respond(400, {"error": "Body must be a JSON object"})
    return body, None


def is_amount(value):
    """A real number of sensible size. Python's json accepts NaN and Infinity; those fail the comparison."""
    return isinstance(value, (int, float)) and not isinstance(value, bool) and abs(value) <= MAX_AMOUNT


def to_money(value):
    """DynamoDB does not accept Python floats."""
    return Decimal(str(round(value, 2)))


def public_receipt(item):
    return {field: item[field] for field in PUBLIC_FIELDS if field in item}


def lambda_handler(event, context):
    route = event.get("routeKey")
    try:
        user_id = get_user_id(event)
        if not user_id:
            # Should be impossible: the routes require a token. If someone ever
            # removes the authorizer, refuse instead of leaking everyone's data.
            return respond(401, {"error": "Unauthorized"})

        receipt_id = (event.get("pathParameters") or {}).get("id")

        if route == "POST /upload-url":
            return create_upload_url(event, user_id)
        if route == "GET /receipts":
            return list_receipts(user_id)
        if route == "GET /receipts/{id}/image":
            return receipt_image(user_id, receipt_id)
        if route == "PATCH /receipts/{id}":
            return update_receipt(event, user_id, receipt_id)
        if route == "DELETE /receipts/{id}":
            return delete_receipt(user_id, receipt_id)
        if route == "GET /budgets":
            return get_budgets(user_id)
        if route == "PUT /budgets":
            return put_budgets(event, user_id)
        return respond(404, {"error": "Not found"})
    except Exception:  # noqa: BLE001 - never leak internals to the client
        logger.exception("Unhandled error on %s", route)
        return respond(500, {"error": "Internal error"})


# --- Upload and list ---

def create_upload_url(event, user_id):
    body, error = read_body(event)
    if error:
        return error

    content_type = body.get("contentType", "image/jpeg")
    if content_type not in TYPES:
        allowed = ", ".join(TYPES)
        return respond(400, {"error": f"contentType must be one of: {allowed}"})

    receipt_id = uuid.uuid4().hex
    key = f"uploads/{receipt_id}.{TYPES[content_type]}"
    now = now_iso()

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

    receipts = [public_receipt(item) for item in items[:MAX_ITEMS]]
    return respond(200, {"receipts": receipts, "count": len(receipts)})


# --- One receipt: photo, edit, delete ---

def get_own_receipt(receipt_id, user_id):
    """The receipt row if it exists AND belongs to this user, otherwise None."""
    if not receipt_id or not RECEIPT_ID.fullmatch(receipt_id):
        return None
    item = table.get_item(Key={"receiptId": receipt_id}).get("Item")
    if not item or item.get("userId") != user_id:
        return None
    return item


def receipt_image(user_id, receipt_id):
    item = get_own_receipt(receipt_id, user_id)
    if not item or not item.get("imageKey"):
        return respond(404, {"error": "Not found"})
    url = s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": BUCKET, "Key": item["imageKey"]},
        ExpiresIn=URL_TTL_SECONDS,
    )
    return respond(200, {"url": url, "expiresIn": URL_TTL_SECONDS})


def parse_changes(body):
    """Check a PATCH body. Returns ({field: value}, None) or (None, "what is wrong")."""
    unknown = sorted(set(body) - set(EDITABLE_FIELDS))
    if unknown:
        return None, f"Unknown field: {unknown[0]}"

    changes = {}
    if "store" in body:
        store = body["store"]
        if store is not None and not isinstance(store, str):
            return None, "store must be text or null"
        store = (store or "").strip()
        if len(store) > 100:
            return None, "store is longer than 100 characters"
        changes["store"] = store or None

    if "date" in body:
        date = body["date"]
        if date is not None:
            if not isinstance(date, str) or not DATE.fullmatch(date):
                return None, "date must look like 2026-10-31, or be null"
            try:
                datetime.strptime(date, "%Y-%m-%d")
            except ValueError:
                return None, "date does not exist"
        changes["date"] = date

    if "total" in body:
        if not is_amount(body["total"]):
            return None, "total must be a number"
        changes["total"] = body["total"]

    if "currency" in body:
        currency = body["currency"]
        if currency is not None:
            if not isinstance(currency, str):
                return None, "currency must be text or null"
            currency = currency.strip().upper() or None
            if currency is not None and not CURRENCY.fullmatch(currency):
                return None, "currency must be a 3-letter code such as EUR"
        changes["currency"] = currency

    if "category" in body:
        if body["category"] not in CATEGORIES:
            return None, f"category must be one of: {', '.join(CATEGORIES)}"
        changes["category"] = body["category"]

    if not changes:
        return None, "Nothing to change"
    return changes, None


def update_receipt(event, user_id, receipt_id):
    body, error = read_body(event)
    if error:
        return error
    changes, problem = parse_changes(body)
    if problem:
        return respond(400, {"error": problem})

    item = get_own_receipt(receipt_id, user_id)
    if not item:
        return respond(404, {"error": "Not found"})
    if item.get("status") != "done":
        return respond(409, {"error": "Only receipts that were read successfully can be edited"})

    names = {"#status": "status", "#updatedAt": "updatedAt", "#edited": "edited"}
    values = {":uid": user_id, ":done": "done", ":now": now_iso(), ":edited": True}
    assignments = ["#updatedAt = :now", "#edited = :edited"]
    for field, value in changes.items():
        names[f"#{field}"] = field  # names go through placeholders: "date" and "total" are reserved words
        values[f":{field}"] = to_money(value) if field == "total" else value
        assignments.append(f"#{field} = :{field}")

    try:
        updated = table.update_item(
            Key={"receiptId": receipt_id},
            UpdateExpression="SET " + ", ".join(assignments),
            # Checked again at write time: the row must still be this user's and still finished.
            ConditionExpression="userId = :uid AND #status = :done",
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=values,
            ReturnValues="ALL_NEW",
        )["Attributes"]
    except ClientError as error:
        if error.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return respond(409, {"error": "The receipt changed while you were editing it. Reload and try again"})
        raise
    return respond(200, {"receipt": public_receipt(updated)})


def delete_receipt(user_id, receipt_id):
    item = get_own_receipt(receipt_id, user_id)
    if not item:
        return respond(404, {"error": "Not found"})

    try:
        table.delete_item(
            Key={"receiptId": receipt_id},
            ConditionExpression="userId = :uid",
            ExpressionAttributeValues={":uid": user_id},
        )
    except ClientError as error:
        if error.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return respond(404, {"error": "Not found"})
        raise

    # The row is gone, which is what the person asked for. A failure to delete the photo
    # is logged but does not turn the answer into an error.
    key = item.get("imageKey")
    if key and key.startswith("uploads/"):
        try:
            s3.delete_object(Bucket=BUCKET, Key=key)
        except ClientError:
            logger.exception("Receipt %s deleted, but its photo %s was not", receipt_id, key)
    return respond(200, {"deleted": True})


# --- Budgets: one row per user, { currency: { category: monthly limit } } ---

def get_budgets(user_id):
    item = budgets_table.get_item(Key={"userId": user_id}).get("Item") or {}
    return respond(200, {"budgets": item.get("limits", {})})


def put_budgets(event, user_id):
    body, error = read_body(event)
    if error:
        return error

    currency = body.get("currency")
    # "?" is how the website names receipts whose currency could not be read.
    if not isinstance(currency, str) or not (CURRENCY.fullmatch(currency) or currency == "?"):
        return respond(400, {"error": "currency must be a 3-letter code such as EUR"})
    limits = body.get("limits")
    if not isinstance(limits, dict) or not limits:
        return respond(400, {"error": "limits must be an object like {\"food\": 200}"})
    for category, value in limits.items():
        if category not in CATEGORIES:
            return respond(400, {"error": f"Unknown category: {category}"})
        if value is not None and not (is_amount(value) and value >= 0):
            return respond(400, {"error": f"The limit for {category} must be a number of 0 or more, or null"})

    item = budgets_table.get_item(Key={"userId": user_id}).get("Item") or {}
    all_limits = item.get("limits", {})
    current = dict(all_limits.get(currency, {}))
    for category, value in limits.items():
        if value is None or value == 0:  # null or 0 removes the limit
            current.pop(category, None)
        else:
            current[category] = to_money(value)
    if current:
        all_limits[currency] = current
    else:
        all_limits.pop(currency, None)

    budgets_table.put_item(Item={"userId": user_id, "limits": all_limits, "updatedAt": now_iso()})
    return respond(200, {"budgets": all_limits})
