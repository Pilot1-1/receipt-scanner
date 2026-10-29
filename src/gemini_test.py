"""
Step 1: test Gemini on receipt photos, locally, before touching AWS.

No external libraries needed (only the Python standard library), so the same
code can later be copied into a Lambda function as-is.

Setup (PowerShell, same window you run the script in):
    $env:GEMINI_API_KEY = "your-key-from-AI-Studio"
    # optional, if the default model name does not work:
    $env:GEMINI_MODEL = "model-name-from-the-list-command"

Usage:
    python src\\gemini_test.py list                      # models your key can use
    python src\\gemini_test.py test-receipts\\r1.jpg     # analyze one receipt
"""
import base64
import json
import mimetypes
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime

API_KEY = os.environ.get("GEMINI_API_KEY")
MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash-lite")
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


def call_gemini(payload):
    """POST to Gemini and return the parsed JSON response."""
    url = f"{BASE_URL}/models/{MODEL}:generateContent"
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-goog-api-key": API_KEY},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


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


def extract_receipt(image_bytes, mime_type, retries=1):
    """Send one receipt image to Gemini and return a validated dict.

    Raises ValueError if the answer is still invalid after the retries.
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
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0,
        },
    }
    last_problem = "unknown"
    for _attempt in range(retries + 1):
        result = call_gemini(payload)
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


def list_models():
    """Print the Flash-type models this API key can call."""
    request = urllib.request.Request(
        f"{BASE_URL}/models?pageSize=200",
        headers={"x-goog-api-key": API_KEY},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        models = json.loads(response.read().decode("utf-8")).get("models", [])
    for model in models:
        name = model["name"].removeprefix("models/")
        if "generateContent" in model.get("supportedGenerationMethods", []) and "flash" in name:
            print(name)


def main():
    if not API_KEY:
        sys.exit('Set the key first:  $env:GEMINI_API_KEY = "your-key"')
    if len(sys.argv) != 2:
        sys.exit(__doc__)

    try:
        if sys.argv[1] == "list":
            list_models()
            return
        path = sys.argv[1]
        mime_type = mimetypes.guess_type(path)[0] or "image/jpeg"
        with open(path, "rb") as file:
            image_bytes = file.read()
        print(f"Model: {MODEL}")
        started = time.time()
        result = extract_receipt(image_bytes, mime_type)
        print(json.dumps(result, indent=2, ensure_ascii=False))
        print(f"Answered in {time.time() - started:.1f} s")
    except urllib.error.HTTPError as error:
        print(f"HTTP {error.code} from Gemini:")
        print(error.read().decode("utf-8", errors="replace"))
        if error.code == 429:
            print("Rate limit reached on the free tier. Wait a minute and retry.")
        if error.code == 404:
            print("Model name not found. Run:  python src\\gemini_test.py list")
        sys.exit(1)
    except (TimeoutError, urllib.error.URLError) as error:
        sys.exit(
            f"No answer from Gemini ({error}). Try a faster model "
            '(for example $env:GEMINI_MODEL = "gemini-2.5-flash-lite") or a smaller photo.'
        )
    except ValueError as error:
        sys.exit(f"Gemini answered, but the JSON was not valid: {error}")
    except FileNotFoundError:
        sys.exit(f"File not found: {sys.argv[1]}")


if __name__ == "__main__":
    main()
