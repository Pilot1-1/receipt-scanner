"""Gemini client: product grouping keys, answer validation, retry logic. No network is used."""
import json
import unittest
from unittest.mock import patch

import helpers

gc = helpers.gemini_client()

GOOD = {
    "store": "Magnum",
    "date": "2026-10-30",
    "total": 1500.0,
    "currency": "KZT",
    "category": "groceries",
    "items": [{"name": "Молоко 2.5% 1л", "quantity": 2, "unit": "pcs", "price": 1000.0}],
}


def gemini_answer(data):
    return {"candidates": [{"content": {"parts": [{"text": json.dumps(data)}]}}]}


class NormalizeKeyTests(unittest.TestCase):
    def test_same_product_on_two_receipts_gets_one_key(self):
        self.assertEqual(gc.normalize_key("Молоко 2.5% 1л"), gc.normalize_key("МОЛОКО 2,5% 900мл"))

    def test_word_order_and_case_do_not_matter(self):
        self.assertEqual(gc.normalize_key("Milk Whole"), gc.normalize_key("whole  MILK"))

    def test_fat_content_is_kept_so_different_products_stay_apart(self):
        self.assertNotEqual(gc.normalize_key("Молоко 2.5%"), gc.normalize_key("Молоко 3.2%"))

    def test_pack_size_and_weight_word_are_dropped(self):
        self.assertEqual(gc.normalize_key("Сахар вес"), "сахар")
        self.assertEqual(gc.normalize_key("Water 500ml"), "water")

    def test_yo_is_written_as_ye(self):
        self.assertEqual(gc.normalize_key("Мёд"), gc.normalize_key("Мед"))


class ValidateTests(unittest.TestCase):
    def test_good_answer_has_no_problems(self):
        self.assertEqual(gc.validate(GOOD), [])

    def test_not_an_object(self):
        self.assertEqual(gc.validate([]), ["answer is not a JSON object"])

    def test_missing_field(self):
        data = {key: value for key, value in GOOD.items() if key != "currency"}
        self.assertIn("missing field: currency", gc.validate(data))

    def test_bad_category(self):
        self.assertTrue(any("bad category" in p for p in gc.validate({**GOOD, "category": "cars"})))

    def test_date_that_does_not_exist(self):
        self.assertTrue(any("does not exist" in p for p in gc.validate({**GOOD, "date": "2026-02-30"})))

    def test_date_in_wrong_format(self):
        self.assertTrue(any("YYYY-MM-DD" in p for p in gc.validate({**GOOD, "date": "30.10.2026"})))

    def test_total_must_be_a_number(self):
        self.assertTrue(any("total" in p for p in gc.validate({**GOOD, "total": "1500"})))
        self.assertTrue(any("total" in p for p in gc.validate({**GOOD, "total": True})))

    def test_items_must_be_a_list(self):
        self.assertIn("items is not a list", gc.validate({**GOOD, "items": "milk"}))

    def test_bad_item_lines_are_reported_with_their_number(self):
        bad = {"name": "", "quantity": 0, "unit": "box", "price": "5"}
        problems = gc.validate({**GOOD, "items": [GOOD["items"][0], bad]})
        self.assertTrue(problems)
        self.assertTrue(all(p.startswith("item 2:") for p in problems))

    def test_unreadable_receipt_with_nulls_is_a_valid_answer(self):
        empty = {"store": None, "date": None, "total": None, "currency": None, "category": "other", "items": []}
        self.assertEqual(gc.validate(empty), [])


class EnrichTests(unittest.TestCase):
    def test_unit_price_and_key_are_added(self):
        (item,) = gc.enrich_items(GOOD["items"])
        self.assertEqual(item["unitPrice"], 500.0)
        self.assertEqual(item["key"], gc.normalize_key("Молоко 2.5% 1л"))

    def test_key_falls_back_to_the_plain_name_when_nothing_is_left(self):
        (item,) = gc.enrich_items([{"name": "1 л", "quantity": 1, "unit": None, "price": 10}])
        self.assertEqual(item["key"], "1 л")


class ExtractReceiptTests(unittest.TestCase):
    def test_valid_answer_is_returned_with_enriched_items(self):
        with patch.object(gc, "call_gemini", return_value=gemini_answer(GOOD)) as call:
            data = gc.extract_receipt(b"image", "image/jpeg", "key", "model")
        self.assertEqual(call.call_count, 1)
        self.assertEqual(data["total"], 1500.0)
        self.assertIn("key", data["items"][0])

    def test_invalid_first_answer_is_retried_once(self):
        answers = [gemini_answer({**GOOD, "category": "cars"}), gemini_answer(GOOD)]
        with patch.object(gc, "call_gemini", side_effect=answers) as call:
            data = gc.extract_receipt(b"image", "image/jpeg", "key", "model")
        self.assertEqual(call.call_count, 2)
        self.assertEqual(data["store"], "Magnum")

    def test_answer_that_stays_invalid_raises_value_error(self):
        with patch.object(gc, "call_gemini", return_value=gemini_answer({**GOOD, "category": "cars"})):
            with self.assertRaises(ValueError) as caught:
                gc.extract_receipt(b"image", "image/jpeg", "key", "model")
        self.assertIn("bad category", str(caught.exception))

    def test_answer_that_is_not_json_is_retried_then_rejected(self):
        broken = {"candidates": [{"content": {"parts": [{"text": "not json"}]}}]}
        with patch.object(gc, "call_gemini", return_value=broken) as call:
            with self.assertRaises(ValueError):
                gc.extract_receipt(b"image", "image/jpeg", "key", "model")
        self.assertEqual(call.call_count, 2)

    def test_answer_cut_off_by_the_token_limit_is_not_retried(self):
        cut = {"candidates": [{"finishReason": "MAX_TOKENS", "content": {"parts": [{"text": "{"}]}}]}
        with patch.object(gc, "call_gemini", return_value=cut) as call:
            with self.assertRaises(ValueError) as caught:
                gc.extract_receipt(b"image", "image/jpeg", "key", "model")
        self.assertEqual(call.call_count, 1)
        self.assertIn("too long", str(caught.exception))

    def test_request_carries_the_image_and_asks_for_json(self):
        with patch.object(gc, "call_gemini", return_value=gemini_answer(GOOD)) as call:
            gc.extract_receipt(b"abc", "application/pdf", "key", "model")
        payload = call.call_args.args[0]
        part = payload["contents"][0]["parts"][0]["inline_data"]
        self.assertEqual(part["mime_type"], "application/pdf")
        self.assertEqual(part["data"], "YWJj")  # base64 of b"abc"
        self.assertEqual(payload["generationConfig"]["responseMimeType"], "application/json")
        self.assertEqual(payload["generationConfig"]["temperature"], 0)


if __name__ == "__main__":
    unittest.main()
