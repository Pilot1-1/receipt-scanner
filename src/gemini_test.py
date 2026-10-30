"""
Step 1b: test receipt reading (including every product line) with Gemini on real
photos, locally, before touching AWS.

Only the Python standard library is used, so this code can be copied into the Lambda
(src/processor/gemini_client.py) as-is once the results look good.

Setup (PowerShell, same window you run the script in):
    $env:GEMINI_API_KEY = "your-key-from-AI-Studio"
    # use the same model as in terraform/envs/dev.tfvars:
    $env:GEMINI_MODEL = "model-name-from-the-list-command"

Usage:
    python src\\gemini_test.py list                               # models your key can use
    python src\\gemini_test.py test-receipts\\r1.jpg               # one receipt
    python src\\gemini_test.py test-receipts                       # every photo in the folder
    python src\\gemini_test.py test-receipts --repeat 3            # each photo 3 times: is the answer stable?
    python src\\gemini_test.py test-receipts --out results.json    # keep the answers (demo data later)

What to look at in the output:
    - "Sum of items vs total": do the product lines add up to the receipt total?
    - the [key] after each product: the same product must get the same key on every receipt.
    - the summary at the end: failures, slowest answer, products that may be the same.
"""
import argparse
import base64
import difflib
import json
import mimetypes
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

API_KEY = os.environ.get("GEMINI_API_KEY")
MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash-lite")
BASE_URL = "https://generativelanguage.googleapis.com/v1beta"

CATEGORIES = [
    "food", "groceries", "transport", "shopping",
    "health", "entertainment", "bills", "other",
]
UNITS = ["pcs", "kg", "g", "l", "ml"]
PHOTO_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}
MAX_OUTPUT_TOKENS = 8192  # a receipt with many lines needs a long answer
RETRY_AFTER_429_SECONDS = 30

PROMPT = f"""You extract data from a photo of a receipt.
Return ONLY a JSON object with exactly these fields:
- "store": merchant name as a string, or null if unreadable
- "date": purchase date as "YYYY-MM-DD", or null if unreadable
- "total": the final amount paid as a number (no currency symbol), or null
- "currency": 3-letter currency code such as "USD", "EUR", "KZT", or null
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
    """Lower case, no pack sizes, no punctuation, words sorted: 'Молоко 2,5% 1л' -> '2p5% молоко'-like key.

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


# --- Talking to Gemini ---

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


def ask_gemini(image_bytes, mime_type, info, retries=1):
    """Send one receipt photo to Gemini and return the validated answer.

    `info` is filled in as we go (requests sent, tokens used), also when this fails.
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
        info["attempts"] += 1  # counted before the call: a 429 also uses up a request
        result = call_gemini(payload)
        usage = result.get("usageMetadata") or {}
        info["prompt_tokens"] += usage.get("promptTokenCount", 0)
        info["answer_tokens"] += usage.get("candidatesTokenCount", 0)

        candidate = (result.get("candidates") or [{}])[0]
        if candidate.get("finishReason") == "MAX_TOKENS":
            raise ValueError(
                f"the answer was cut off (MAX_TOKENS): the receipt is too long for MAX_OUTPUT_TOKENS={MAX_OUTPUT_TOKENS}"
            )
        try:
            data = json.loads(candidate["content"]["parts"][0]["text"])
        except (KeyError, IndexError, json.JSONDecodeError) as error:
            last_problem = f"could not read the answer: {error!r}"
            continue
        problems = validate(data)
        if not problems:
            return data
        last_problem = "; ".join(problems[:6])
    raise ValueError(last_problem)


# --- What the app will store, and the checks on it ---

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


def check_sum(data):
    """Do the product lines add up to the total? Returns (ok, difference) or None if it cannot be checked."""
    total = data.get("total")
    items = data.get("items") or []
    if total is None or not items:
        return None
    difference = round(sum(item["price"] for item in items) - total, 2)
    tolerance = max(1.0, abs(total) * 0.02)  # a small gap is normal: rounding, discounts, bags
    return abs(difference) <= tolerance, difference


def run_receipt(path, run_number):
    """Process one photo and return a record with the answer or the reason it failed."""
    mime_type = mimetypes.guess_type(str(path))[0] or "image/jpeg"
    image_bytes = path.read_bytes()
    record = {"file": path.name, "run": run_number}
    info = {"attempts": 0, "prompt_tokens": 0, "answer_tokens": 0}
    started = time.time()
    for attempt in range(2):  # the second attempt happens only after a 429
        try:
            data = ask_gemini(image_bytes, mime_type, info)
            data["items"] = enrich_items(data["items"])
            record.update(ok=True, data=data)
        except urllib.error.HTTPError as error:
            if error.code == 429 and attempt == 0:
                print(f"\n  {path.name}: rate limit (429), waiting {RETRY_AFTER_429_SECONDS} s, then one more try...")
                time.sleep(RETRY_AFTER_429_SECONDS)
                continue
            detail = error.read().decode("utf-8", errors="replace")[:300]
            hint = " (model name not found: run  python src\\gemini_test.py list)" if error.code == 404 else ""
            record.update(ok=False, error=f"HTTP {error.code}{hint}: {detail}")
        except (TimeoutError, urllib.error.URLError) as error:
            record.update(ok=False, error=f"no answer from Gemini: {error}")
        except ValueError as error:
            record.update(ok=False, error=f"invalid answer: {error}")
        break
    record.update(info)
    record["seconds"] = round(time.time() - started, 1)
    return record


# --- Reporting ---

def print_record(record, repeat):
    label = record["file"] + (f" (run {record['run']}/{repeat})" if repeat > 1 else "")
    print(f"\n=== {label} ===")
    if not record["ok"]:
        print(f"FAILED: {record['error']}")
        return
    data = record["data"]
    print(f"{data['store']} | {data['date']} | {data['total']} {data['currency']} | category: {data['category']}")
    print(f"Items: {len(data['items'])}")
    for number, item in enumerate(data["items"], start=1):
        print(
            f"  {number:>2}. {item['name'][:34]:<34} {item['quantity']:>7} {item['unit'] or '-':<4}"
            f" {item['price']:>10} -> {item['unitPrice']:>9}  [{item['key']}]"
        )
    check = check_sum(data)
    if check is None:
        print("Sum check: not possible (no total or no items)")
    else:
        ok, difference = check
        total_of_items = round(sum(item["price"] for item in data["items"]), 2)
        verdict = "OK" if ok else "MISMATCH"
        print(f"Sum of items {total_of_items} vs total {data['total']}: difference {difference:+} -> {verdict}")
    print(f"{record['seconds']} s, {record['prompt_tokens']} prompt + {record['answer_tokens']} answer tokens")


def signature(data):
    """What must not change between two runs on the same photo."""
    return {
        "store": data["store"],
        "total": data["total"],
        "category": data["category"],
        "number of items": len(data["items"]),
        "product keys": tuple(sorted(item["key"] for item in data["items"])),
    }


def print_stability(records):
    print("\n--- Stability (same photo, several runs) ---")
    for name in sorted({r["file"] for r in records}):
        runs = [r for r in records if r["file"] == name and r["ok"]]
        if len(runs) < 2:
            print(f"{name}: fewer than 2 successful runs, cannot compare")
            continue
        first = signature(runs[0]["data"])
        different = sorted({
            field
            for other in runs[1:]
            for field, value in signature(other["data"]).items()
            if value != first[field]
        })
        print(f"{name}: " + ("stable" if not different else "DIFFERENT in: " + ", ".join(different)))


def abbreviation_of(short, long):
    """True if every word of `short` equals, or is the beginning (3+ letters) of, a word of `long`."""
    long_words = long.split()
    return all(
        any(word == other or (len(word) >= 3 and other.startswith(word)) for other in long_words)
        for word in short.split()
    )


def similar_keys(keys, threshold=0.75, limit=15):
    """Pairs of different keys that may be one product: similar spelling, or one is an abbreviation of the other."""
    keys = sorted(keys)
    pairs = []
    for index, first in enumerate(keys):
        for second in keys[index + 1:]:
            ratio = difflib.SequenceMatcher(None, first, second).ratio()
            abbreviation = abbreviation_of(first, second) or abbreviation_of(second, first)
            if ratio >= threshold or abbreviation:
                pairs.append((ratio, first, second, abbreviation))
    return sorted(pairs, reverse=True)[:limit]


def print_summary(records, repeat):
    good = [r for r in records if r["ok"]]
    bad = [r for r in records if not r["ok"]]
    print("\n==================== SUMMARY ====================")
    print(f"Model: {MODEL}")
    print(f"Runs: {len(records)}, read OK: {len(good)}, failed: {len(bad)}")

    checked = [(r, check_sum(r["data"])) for r in good]
    checked = [(r, c) for r, c in checked if c is not None]
    if checked:
        matching = sum(1 for _, (ok, _) in checked if ok)
        print(f"Items add up to the total: {matching} of {len(checked)} receipts")
        for record, (ok, difference) in checked:
            if not ok:
                print(f"  mismatch: {record['file']} (difference {difference:+})")
    empty = [r["file"] for r in good if not r["data"]["items"]]
    if empty:
        print(f"No product lines found on: {', '.join(sorted(set(empty)))}")

    if good:
        seconds = [r["seconds"] for r in good]
        print(f"Time per photo: average {sum(seconds) / len(seconds):.1f} s, slowest {max(seconds):.1f} s")
    print(
        f"Requests sent to Gemini: {sum(r['attempts'] for r in records)}; tokens: "
        f"{sum(r['prompt_tokens'] for r in records)} prompt + {sum(r['answer_tokens'] for r in records)} answer"
    )
    for record in bad:
        print(f"FAILED {record['file']} (run {record['run']}): {record['error']}")

    if repeat > 1:
        print_stability(records)

    files_by_key = {}
    for record in good:
        for item in record["data"]["items"]:
            files_by_key.setdefault(item["key"], set()).add(record["file"])
    shared = {key: files for key, files in files_by_key.items() if len(files) >= 2}
    print("\n--- Products found on 2+ different receipts (the price tracker will use these) ---")
    if shared:
        for key, files in sorted(shared.items(), key=lambda pair: -len(pair[1])):
            print(f"  [{key}]  on {len(files)} receipts")
    else:
        print("  none yet: use several receipts from the same store")

    pairs = similar_keys(files_by_key.keys())
    print("\n--- Different keys that look similar: the same product? (check by eye) ---")
    if pairs:
        for ratio, first, second, abbreviation in pairs:
            note = "  (one looks like an abbreviation of the other)" if abbreviation else ""
            print(f"  {ratio:.2f}  [{first}]  vs  [{second}]{note}")
    else:
        print("  none")


def collect_files(paths):
    files = []
    for raw in paths:
        path = Path(raw)
        if path.is_dir():
            files.extend(sorted(p for p in path.iterdir() if p.suffix.lower() in PHOTO_SUFFIXES))
        elif path.is_file():
            files.append(path)
        else:
            sys.exit(f"Not found: {raw}")
    if not files:
        sys.exit("No photos found (looking for .jpg, .jpeg, .png, .webp)")
    return files


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
    if hasattr(sys.stdout, "reconfigure"):  # Cyrillic receipts must not crash a Windows console
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("paths", nargs="+", help='photo files, folders with photos, or the word "list"')
    parser.add_argument("--repeat", type=int, default=1, help="runs per photo (to see if the answer is stable)")
    parser.add_argument("--out", help="write all answers to this JSON file")
    parser.add_argument("--pause", type=float, default=4.0, help="seconds between requests (free-tier rate limit)")
    args = parser.parse_args()

    if not API_KEY:
        sys.exit('Set the key first:  $env:GEMINI_API_KEY = "your-key"')

    if args.paths == ["list"]:
        try:
            list_models()
        except urllib.error.HTTPError as error:
            sys.exit(f"HTTP {error.code}: {error.read().decode('utf-8', errors='replace')[:300]}")
        return

    files = collect_files(args.paths)
    print(f"Model: {MODEL}; photos: {len(files)}; runs per photo: {args.repeat}")

    records = []
    for path in files:
        for run in range(1, args.repeat + 1):
            if records:
                time.sleep(args.pause)
            record = run_receipt(path, run)
            records.append(record)
            print_record(record, args.repeat)

    print_summary(records, args.repeat)

    if args.out:
        Path(args.out).write_text(json.dumps(records, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"\nAnswers saved to {args.out}")


if __name__ == "__main__":
    main()
