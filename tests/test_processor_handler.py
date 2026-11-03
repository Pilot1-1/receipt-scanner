"""Processor Lambda: S3 event -> Gemini -> DynamoDB. AWS and Gemini are replaced by mocks."""
import io
import unittest
import urllib.error
from decimal import Decimal
from unittest.mock import MagicMock

import helpers

RECEIPT_ID = "0123456789abcdef0123456789abcdef"
KEY = f"uploads/{RECEIPT_ID}.jpg"

DATA = {
    "store": "Magnum",
    "date": "2026-10-30",
    "total": 1234.5,
    "currency": "KZT",
    "category": "groceries",
    "items": [{"name": "Milk", "quantity": 1, "unit": "l", "price": 500.0, "unitPrice": 500.0, "key": "milk"}],
}


def s3_object(size=1000, content_type="image/jpeg"):
    return {"ContentLength": size, "Body": io.BytesIO(b"bytes"), "ContentType": content_type}


class ProcessTests(unittest.TestCase):
    def setUp(self):
        self.h = helpers.processor()
        self.h.table.get_item.return_value = {
            "Item": {"receiptId": RECEIPT_ID, "userId": "user-1", "status": "processing", "createdAt": "2026-10-30T10:00:00+00:00"}
        }
        self.h.s3.get_object.return_value = s3_object()
        self.h.extract_receipt = MagicMock(return_value=DATA)

    def saved(self):
        self.h.table.put_item.assert_called_once()
        return self.h.table.put_item.call_args.kwargs

    def test_successful_read_is_saved_with_owner_and_numbers_as_decimal(self):
        self.h.process("bucket", KEY)
        call = self.saved()
        item = call["Item"]
        self.assertEqual(item["status"], "done")
        self.assertEqual(item["userId"], "user-1")  # without this the receipt vanishes from its owner's list
        self.assertEqual(item["createdAt"], "2026-10-30T10:00:00+00:00")
        self.assertEqual(item["total"], Decimal("1234.5"))
        self.assertEqual(item["items"][0]["price"], Decimal("500.0"))
        self.assertEqual(item["imageKey"], KEY)
        self.assertEqual(call["ConditionExpression"], "attribute_exists(receiptId)")

    def test_gemini_gets_the_file_type_from_the_key(self):
        self.h.process("bucket", f"uploads/{RECEIPT_ID}.pdf")
        self.assertEqual(self.h.extract_receipt.call_args.args[1], "application/pdf")

    def test_deleted_receipt_is_skipped_without_calling_gemini(self):
        self.h.table.get_item.return_value = {}
        self.h.process("bucket", KEY)
        self.h.extract_receipt.assert_not_called()
        self.h.table.put_item.assert_not_called()

    def test_already_processed_receipt_is_skipped(self):
        self.h.table.get_item.return_value = {"Item": {"receiptId": RECEIPT_ID, "status": "done"}}
        self.h.process("bucket", KEY)
        self.h.extract_receipt.assert_not_called()
        self.h.table.put_item.assert_not_called()

    def test_missing_total_is_saved_as_failed(self):
        self.h.extract_receipt.return_value = {**DATA, "total": None}
        self.h.process("bucket", KEY)
        item = self.saved()["Item"]
        self.assertEqual(item["status"], "failed")
        self.assertIn("total", item["error"])
        self.assertEqual(item["userId"], "user-1")

    def test_file_over_7_mb_is_rejected_before_gemini(self):
        self.h.s3.get_object.return_value = s3_object(size=8 * 1024 * 1024)
        self.h.process("bucket", KEY)
        self.h.extract_receipt.assert_not_called()
        self.assertIn("7 MB", self.saved()["Item"]["error"])

    def test_unsupported_file_type_is_rejected(self):
        self.h.process("bucket", f"uploads/{RECEIPT_ID}.txt")
        self.h.extract_receipt.assert_not_called()
        item = self.saved()["Item"]
        self.assertEqual(item["status"], "failed")
        self.assertIn("Unsupported", item["error"])

    def test_gemini_rate_limit_has_a_friendly_message(self):
        self.h.extract_receipt.side_effect = urllib.error.HTTPError("http://x", 429, "Too Many", {}, io.BytesIO(b"quota"))
        self.h.process("bucket", KEY)
        item = self.saved()["Item"]
        self.assertEqual(item["status"], "failed")
        self.assertIn("rate limit", item["error"])

    def test_other_gemini_http_error_names_the_code_and_model(self):
        self.h.extract_receipt.side_effect = urllib.error.HTTPError("http://x", 500, "Boom", {}, io.BytesIO(b"x"))
        self.h.process("bucket", KEY)
        self.assertEqual(self.saved()["Item"]["error"], "Gemini error 500 (model test-model)")

    def test_gemini_http_error_is_logged_as_the_alarm_expects(self):
        # The CloudWatch metric filter in terraform/modules/monitoring counts log lines with "Gemini HTTP".
        self.h.extract_receipt.side_effect = urllib.error.HTTPError("http://x", 429, "Too Many", {}, io.BytesIO(b"quota"))
        with self.assertLogs(level="WARNING") as logs:
            self.h.process("bucket", KEY)
        self.assertTrue(any("Gemini HTTP" in line for line in logs.output))

    def test_any_other_failure_is_saved_not_raised(self):
        self.h.extract_receipt.side_effect = RuntimeError("network down")
        self.h.process("bucket", KEY)  # must not raise: S3 would retry and burn the Gemini quota
        item = self.saved()["Item"]
        self.assertEqual(item["status"], "failed")
        self.assertEqual(item["error"], "network down")

    def test_receipt_deleted_while_being_read_is_not_recreated(self):
        self.h.table.put_item.side_effect = helpers.client_error("ConditionalCheckFailedException", "PutItem")
        self.h.process("bucket", KEY)  # swallowed

    def test_other_dynamodb_errors_are_raised(self):
        self.h.table.put_item.side_effect = helpers.client_error("ProvisionedThroughputExceededException", "PutItem")
        with self.assertRaises(helpers.ClientError):
            self.h.process("bucket", KEY)


class LambdaHandlerTests(unittest.TestCase):
    def test_every_record_is_processed_with_the_key_url_decoded(self):
        h = helpers.processor()
        h.process = MagicMock()
        event = {"Records": [
            {"s3": {"bucket": {"name": "b"}, "object": {"key": "uploads/a%2Bb+c.jpg"}}},
            {"s3": {"bucket": {"name": "b"}, "object": {"key": "uploads/second.png"}}},
        ]}
        h.lambda_handler(event, None)
        self.assertEqual(h.process.call_args_list[0].args, ("b", "uploads/a+b c.jpg"))
        self.assertEqual(h.process.call_args_list[1].args, ("b", "uploads/second.png"))

    def test_event_without_records_does_nothing(self):
        h = helpers.processor()
        h.process = MagicMock()
        h.lambda_handler({}, None)
        h.process.assert_not_called()


if __name__ == "__main__":
    unittest.main()
