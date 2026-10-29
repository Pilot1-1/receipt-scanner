"""Talks to the Gemini API. Standard library only, so no Lambda layer is needed."""
import base64
import json
import re
import urllib.request
from datetime import datetime

BASE_URL = "https://generativelanguage.googleapis.com/v1beta"

CATEGORIES = [
    "food", "groceries", "transport", "shopping",
    "health", "entertainment", "bills", "other",
]

PROMPT = f"""You extract data from a photo of a receipt.
Return ONLY a JSON object with exactly these fields:
- "store": merchant name as a string, or null if unreadable
- "date": purchase date as "YYYY-MM-DD", or null if unreadable
- "total": the final amount paid as a number (no currency symbol), or null
- "currency": 3-letter currency code such as "USD", "EUR", "KZT", or null
- "category": exactly one of {json.dumps(CATEGORIES)}
If the image is not a receipt or cannot be read, use null for every field
except "category", which must be "other"."""


def validate(data):
    """Return a list of problems with the model's answer (empty list = OK)."""
    if not isinstance(data, dict):
        return ["answer is not a JSON object"]
    problems = []
    for field in ("store", "date", "total", "currency", "category"):
        if field not in data:
            problems.append(f"missing field: {field}")
    if data.get("category") not in CATEGORIES:
        problems.append(f"bad category: {data.get('category')!r}")
    total = data.get("total")
    if total is not None and (isinstance(total, bool) or not isinstance(total, (int, float))):
        problems.append(f"total is not a number: {total!r}")
    date = data.get("date")
    if date is not None:
        if not isinstance(date, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
            problems.append(f"date is not YYYY-MM-DD: {date!r}")
        else:
            try:
                datetime.strptime(date, "%Y-%m-%d")
            except ValueError:
                problems.append(f"date does not exist: {date!r}")
    return problems


def call_gemini(payload, api_key, model, timeout=60):
    request = urllib.request.Request(
        f"{BASE_URL}/models/{model}:generateContent",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def extract_receipt(image_bytes, mime_type, api_key, model, retries=1):
    """Send one receipt image to Gemini and return a validated dict.

    Raises ValueError if the answer is still invalid after the retries.
    HTTP errors (for example 429 rate limit) propagate to the caller.
    """
    payload = {
        "contents": [{
            "parts": [
                {"inline_data": {
                    "mime_type": mime_type,
                    "data": base64.b64encode(image_bytes).decode("ascii"),
                }},
                {"text": PROMPT},
            ]
        }],
        "generationConfig": {"responseMimeType": "application/json", "temperature": 0},
    }
    last_problem = "unknown"
    for _attempt in range(retries + 1):
        result = call_gemini(payload, api_key, model)
        try:
            text = result["candidates"][0]["content"]["parts"][0]["text"]
            data = json.loads(text)
        except (KeyError, IndexError, json.JSONDecodeError) as error:
            last_problem = f"could not read the answer: {error!r}"
            continue
        problems = validate(data)
        if not problems:
            return data
        last_problem = "; ".join(problems)
    raise ValueError(last_problem)
