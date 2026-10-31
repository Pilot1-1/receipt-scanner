"""Talks to the Gemini API. Standard library only, so no Lambda layer is needed.

PROMPT, normalize_key() and validate() are the same code that src/gemini_test.py
checks on real receipt photos. Change them there first, then copy them here.
"""
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
UNITS = ["pcs", "kg", "g", "l", "ml"]
MAX_OUTPUT_TOKENS = 8192  # a receipt with many lines needs a long answer

PROMPT = f"""You extract data from a photo of a receipt.
Return ONLY a JSON object with exactly these fields:
- "store": merchant name as a string, or null if unreadable
- "date": purchase date as "YYYY-MM-DD", or null if unreadable
- "total": the final amount paid as a number (no currency symbol), or null
- "currency": 3-letter ISO currency code such as "USD", "EUR", "KZT", "RUB", "TRY", or null if you cannot tell.
  Use the symbol or word printed on the receipt first:
  "₸", "тг", "тенге" -> KZT; "₽", "руб" -> RUB; "₺", "TL" -> TRY; "$" -> USD; "€" -> EUR.
  If none is printed, work out the country from the receipt itself (address, city, store chain, tax identifiers
  such as ИНН for Russia or БИН/ИИН for Kazakhstan) and use that country's currency.
  The language alone is not enough: Russian is written on receipts in Russia and in Kazakhstan.
- "category": exactly one of {json.dumps(CATEGORIES)}
  (food = cafes, restaurants, food delivery; groceries = supermarkets and food shops;
   bills = utilities, phone, internet, rent)
- "items": a list with one object per purchased product line, or [] if no lines are readable.
  Each object has exactly these fields:
    "name": the product name as printed on the receipt, as a string
    "quantity": a number; 1 if the receipt shows no quantity; for goods sold by weight or volume, the weight or volume
    "unit": one of {json.dumps(UNITS)}, or null if unknown
    "price": the total paid for this line, as a number (after any discount printed for that line)
List purchased goods only. Skip tax, bonus points, payment method, change, rounding and total lines.
If the image is not a receipt or cannot be read, use null for every field except "category"
(which must be "other") and "items" (which must be [])."""


# --- Grouping key: the same product on different receipts must give the same key ---

SIZE_TOKEN = re.compile(r"^\d+(p\d+)?(л|мл|г|гр|кг|шт|l|ml|g|gr|kg|pcs)?$")
# Words that say nothing about WHICH product it is: units, and "вес" (sold by weight).
UNIT_WORDS = {"л", "мл", "г", "гр", "кг", "шт", "l", "ml", "g", "gr", "kg", "pcs", "вес"}
SEPARATORS = re.compile(r"[\s.,;:/\\()\-'*+«»\"]+")


def normalize_key(name):
    """Lower case, no pack sizes, no punctuation, words sorted.

    Sizes ("1л", "500г") are dropped; a number with a % sign (fat content) is kept.
    """
    text = name.lower().replace("ё", "е")
    text = re.sub(r"(?<=\d)[.,](?=\d)", "p", text)  # 2.5 -> 2p5, so the dot is not a separator
    words = []
    for raw in SEPARATORS.split(text):
        token = re.sub(r"[^\w]", "", raw).replace("_", "")
        if not token or token in UNIT_WORDS:
            continue
        if SIZE_TOKEN.match(token) and "%" not in raw:
            continue
        words.append(token)
    return " ".join(sorted(set(words)))


# --- Checking the model's answer ---

def is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def validate_item(item):
    """Return a list of problems with one product line (empty list = OK)."""
    if not isinstance(item, dict):
        return ["not an object"]
    problems = []
    name = item.get("name")
    if not isinstance(name, str) or not name.strip():
        problems.append("name is empty")
    quantity = item.get("quantity")
    if not is_number(quantity) or quantity <= 0:
        problems.append(f"quantity must be a positive number: {quantity!r}")
    if not is_number(item.get("price")):
        problems.append(f"price is not a number: {item.get('price')!r}")
    unit = item.get("unit")
    if unit is not None and unit not in UNITS:
        problems.append(f"bad unit: {unit!r}")
    return problems


def validate(data):
    """Return a list of problems with the model's answer (empty list = OK)."""
    if not isinstance(data, dict):
        return ["answer is not a JSON object"]
    problems = []
    for field in ("store", "date", "total", "currency", "category", "items"):
        if field not in data:
            problems.append(f"missing field: {field}")
    if data.get("category") not in CATEGORIES:
        problems.append(f"bad category: {data.get('category')!r}")
    total = data.get("total")
    if total is not None and not is_number(total):
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
    if "items" in data:
        if not isinstance(data["items"], list):
            problems.append("items is not a list")
        else:
            for number, item in enumerate(data["items"], start=1):
                problems.extend(f"item {number}: {p}" for p in validate_item(item))
    return problems


def enrich_items(items):
    """Add what the app stores next to each product line: price per unit and grouping key."""
    return [
        {
            **item,
            "unitPrice": round(item["price"] / item["quantity"], 2),
            # If nothing is left after cleaning (a name like "1 л"), fall back to the plain name.
            "key": normalize_key(item["name"]) or item["name"].lower().strip(),
        }
        for item in items
    ]


# --- Talking to Gemini ---

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

    The product lines in data["items"] already carry "unitPrice" and "key".
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
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0,
            "maxOutputTokens": MAX_OUTPUT_TOKENS,
        },
    }
    last_problem = "unknown"
    for _attempt in range(retries + 1):
        result = call_gemini(payload, api_key, model)
        candidate = (result.get("candidates") or [{}])[0]
        if candidate.get("finishReason") == "MAX_TOKENS":
            raise ValueError("The receipt is too long to read completely")
        try:
            data = json.loads(candidate["content"]["parts"][0]["text"])
        except (KeyError, IndexError, json.JSONDecodeError) as error:
            last_problem = f"could not read the answer: {error!r}"
            continue
        problems = validate(data)
        if not problems:
            data["items"] = enrich_items(data["items"])
            return data
        last_problem = "; ".join(problems[:6])
    raise ValueError(last_problem)
