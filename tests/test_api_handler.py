"""API Lambda: routing, validation and, above all, that one user can never touch another user's data."""
import json
import unittest
from decimal import Decimal

import helpers

RECEIPT_ID = "0123456789abcdef0123456789abcdef"
USER = "user-1"
OTHER = "user-2"


def event(route, user=USER, body=None, receipt_id=None, raw_body=None):
    """What API Gateway (HTTP API, payload 2.0) hands to the Lambda after the JWT check."""
    result = {"routeKey": route, "requestContext": {}}
    if user is not None:
        result["requestContext"] = {"authorizer": {"jwt": {"claims": {"sub": user}}}}
    if receipt_id is not None:
        result["pathParameters"] = {"id": receipt_id}
    if raw_body is not None:
        result["body"] = raw_body
    elif body is not None:
        result["body"] = json.dumps(body)
    return result


def own_receipt(**extra):
    return {"Item": {
        "receiptId": RECEIPT_ID, "userId": USER, "status": "done", "imageKey": f"uploads/{RECEIPT_ID}.jpg",
        "store": "Magnum", "total": Decimal("100"), **extra,
    }}


class ApiTestCase(unittest.TestCase):
    def setUp(self):
        self.h = helpers.api()

    def call(self, *args, **kwargs):
        response = self.h.lambda_handler(event(*args, **kwargs), None)
        return response["statusCode"], json.loads(response["body"])


class RoutingAndAuthTests(ApiTestCase):
    def test_request_without_a_verified_user_is_refused(self):
        status, body = self.call("GET /receipts", user=None)
        self.assertEqual(status, 401)
        self.h.table.query.assert_not_called()

    def test_unknown_route_is_404(self):
        status, _ = self.call("GET /nothing")
        self.assertEqual(status, 404)

    def test_unexpected_error_is_a_generic_500(self):
        self.h.table.query.side_effect = RuntimeError("secret internals")
        response = self.h.lambda_handler(event("GET /receipts"), None)
        self.assertEqual(response["statusCode"], 500)
        self.assertNotIn("secret", response["body"])

    def test_responses_are_never_cached(self):
        response = self.h.lambda_handler(event("GET /nothing"), None)
        self.assertEqual(response["headers"]["Cache-Control"], "no-store")


class UploadUrlTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.h.s3.generate_presigned_url.return_value = "https://bucket.s3.example/signed"

    def test_row_is_created_for_the_user_before_the_link_is_returned(self):
        status, body = self.call("POST /upload-url", body={"contentType": "image/png"})
        self.assertEqual(status, 200)
        item = self.h.table.put_item.call_args.kwargs["Item"]
        self.assertEqual(item["userId"], USER)
        self.assertEqual(item["status"], "processing")
        self.assertRegex(item["receiptId"], r"^[0-9a-f]{32}$")
        self.assertEqual(item["imageKey"], f"uploads/{item['receiptId']}.png")
        self.assertEqual(body["receiptId"], item["receiptId"])
        self.assertEqual(body["uploadUrl"], "https://bucket.s3.example/signed")

    def test_default_type_is_jpeg(self):
        self.call("POST /upload-url", body={})
        self.assertTrue(self.h.table.put_item.call_args.kwargs["Item"]["imageKey"].endswith(".jpg"))

    def test_pdf_is_allowed(self):
        status, body = self.call("POST /upload-url", body={"contentType": "application/pdf"})
        self.assertEqual(status, 200)
        self.assertEqual(body["contentType"], "application/pdf")

    def test_link_is_signed_for_one_key_and_one_content_type(self):
        self.call("POST /upload-url", body={"contentType": "image/webp"})
        kwargs = self.h.s3.generate_presigned_url.call_args.kwargs
        self.assertEqual(kwargs["Params"]["ContentType"], "image/webp")
        self.assertTrue(kwargs["Params"]["Key"].startswith("uploads/"))
        self.assertEqual(kwargs["ExpiresIn"], 300)

    def test_other_file_types_are_refused(self):
        status, _ = self.call("POST /upload-url", body={"contentType": "application/zip"})
        self.assertEqual(status, 400)
        self.h.table.put_item.assert_not_called()

    def test_invalid_json_is_400(self):
        status, _ = self.call("POST /upload-url", raw_body="{not json")
        self.assertEqual(status, 400)

    def test_json_that_is_not_an_object_is_400(self):
        status, _ = self.call("POST /upload-url", raw_body="[1, 2]")
        self.assertEqual(status, 400)


class ListReceiptsTests(ApiTestCase):
    def test_only_the_users_own_rows_are_requested_newest_first(self):
        self.h.table.query.return_value = {"Items": []}
        self.call("GET /receipts")
        kwargs = self.h.table.query.call_args.kwargs
        self.assertEqual(kwargs["IndexName"], "userId-createdAt-index")
        self.assertIs(kwargs["ScanIndexForward"], False)
        condition = kwargs["KeyConditionExpression"]
        self.assertIn(USER, str(getattr(condition, "__dict__", condition)))  # the user's id is in the key condition

    def test_internal_fields_are_not_returned(self):
        self.h.table.query.return_value = {"Items": [
            {"receiptId": RECEIPT_ID, "userId": USER, "imageKey": "uploads/x.jpg", "status": "done", "store": "Magnum", "total": Decimal("10.5")}
        ]}
        status, body = self.call("GET /receipts")
        self.assertEqual(status, 200)
        self.assertEqual(body["count"], 1)
        receipt = body["receipts"][0]
        self.assertNotIn("userId", receipt)
        self.assertNotIn("imageKey", receipt)
        self.assertEqual(receipt["total"], 10.5)

    def test_whole_numbers_come_back_as_integers(self):
        self.h.table.query.return_value = {"Items": [{"receiptId": RECEIPT_ID, "total": Decimal("100")}]}
        _, body = self.call("GET /receipts")
        self.assertEqual(body["receipts"][0]["total"], 100)
        self.assertIsInstance(body["receipts"][0]["total"], int)

    def test_all_pages_are_read(self):
        self.h.table.query.side_effect = [
            {"Items": [{"receiptId": "a"}], "LastEvaluatedKey": {"receiptId": "a"}},
            {"Items": [{"receiptId": "b"}]},
        ]
        _, body = self.call("GET /receipts")
        self.assertEqual(body["count"], 2)
        self.assertEqual(self.h.table.query.call_args_list[1].kwargs["ExclusiveStartKey"], {"receiptId": "a"})

    def test_list_is_capped(self):
        page = {"Items": [{"receiptId": str(n)} for n in range(150)], "LastEvaluatedKey": {"receiptId": "x"}}
        self.h.table.query.return_value = page
        _, body = self.call("GET /receipts")
        self.assertEqual(body["count"], self.h.MAX_ITEMS)


class ReceiptImageTests(ApiTestCase):
    def test_own_photo_gets_a_temporary_link(self):
        self.h.table.get_item.return_value = own_receipt()
        self.h.s3.generate_presigned_url.return_value = "https://signed"
        status, body = self.call("GET /receipts/{id}/image", receipt_id=RECEIPT_ID)
        self.assertEqual(status, 200)
        self.assertEqual(body["url"], "https://signed")
        self.assertEqual(body["contentType"], "image/jpeg")

    def test_pdf_is_reported_as_pdf(self):
        self.h.table.get_item.return_value = own_receipt(imageKey=f"uploads/{RECEIPT_ID}.pdf")
        self.h.s3.generate_presigned_url.return_value = "https://signed"
        _, body = self.call("GET /receipts/{id}/image", receipt_id=RECEIPT_ID)
        self.assertEqual(body["contentType"], "application/pdf")

    def test_someone_elses_receipt_looks_like_it_does_not_exist(self):
        self.h.table.get_item.return_value = own_receipt(userId=OTHER)
        status, _ = self.call("GET /receipts/{id}/image", receipt_id=RECEIPT_ID)
        self.assertEqual(status, 404)
        self.h.s3.generate_presigned_url.assert_not_called()

    def test_malformed_id_never_reaches_the_database(self):
        for bad in ("../../etc/passwd", "short", RECEIPT_ID.upper(), RECEIPT_ID + "0"):
            status, _ = self.call("GET /receipts/{id}/image", receipt_id=bad)
            self.assertEqual(status, 404, bad)
        self.h.table.get_item.assert_not_called()

    def test_missing_receipt_is_404(self):
        self.h.table.get_item.return_value = {}
        status, _ = self.call("GET /receipts/{id}/image", receipt_id=RECEIPT_ID)
        self.assertEqual(status, 404)


class UpdateReceiptTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.h.table.get_item.return_value = own_receipt()
        self.h.table.update_item.return_value = {"Attributes": {"receiptId": RECEIPT_ID, "store": "Shop", "edited": True}}

    def patch(self, body, **kwargs):
        return self.call("PATCH /receipts/{id}", body=body, receipt_id=RECEIPT_ID, **kwargs)

    def test_successful_edit_is_checked_again_inside_dynamodb(self):
        status, body = self.patch({"store": "  Shop  ", "currency": " eur ", "total": 99.9, "category": "food", "date": "2026-10-31"})
        self.assertEqual(status, 200)
        self.assertTrue(body["receipt"]["edited"])
        kwargs = self.h.table.update_item.call_args.kwargs
        self.assertEqual(kwargs["ConditionExpression"], "userId = :uid AND #status = :done")
        values = kwargs["ExpressionAttributeValues"]
        self.assertEqual(values[":uid"], USER)
        self.assertEqual(values[":store"], "Shop")
        self.assertEqual(values[":currency"], "EUR")
        self.assertEqual(values[":total"], Decimal("99.9"))
        self.assertIs(values[":edited"], True)
        self.assertNotIn("userId", body["receipt"])

    def test_empty_store_becomes_null(self):
        self.patch({"store": "   "})
        self.assertIsNone(self.h.table.update_item.call_args.kwargs["ExpressionAttributeValues"][":store"])

    def test_unknown_or_protected_fields_are_refused(self):
        for field in ("userId", "status", "items", "receiptId"):
            status, body = self.patch({field: "x"})
            self.assertEqual(status, 400, field)
            self.assertIn(field, body["error"])
        self.h.table.update_item.assert_not_called()

    def test_empty_change_is_refused(self):
        status, _ = self.patch({})
        self.assertEqual(status, 400)

    def test_bad_values_are_refused(self):
        bad_bodies = [
            {"date": "31.10.2026"}, {"date": "2026-02-30"}, {"date": 20261031},
            {"total": "100"}, {"total": True}, {"total": 10 ** 12}, {"total": float("nan")}, {"total": float("inf")},
            {"currency": "EURO"}, {"currency": 5},
            {"category": "cars"},
            {"store": 5}, {"store": "x" * 101},
        ]
        for body in bad_bodies:
            status, _ = self.patch(body)  # json.dumps writes NaN / Infinity, which Python's json.loads accepts
            self.assertEqual(status, 400, body)
        self.h.table.update_item.assert_not_called()

    def test_null_date_and_currency_are_allowed(self):
        status, _ = self.patch({"date": None, "currency": None})
        self.assertEqual(status, 200)

    def test_someone_elses_receipt_is_404(self):
        self.h.table.get_item.return_value = own_receipt(userId=OTHER)
        status, _ = self.patch({"store": "Mine now"})
        self.assertEqual(status, 404)
        self.h.table.update_item.assert_not_called()

    def test_receipt_still_being_read_cannot_be_edited(self):
        self.h.table.get_item.return_value = own_receipt(status="processing")
        status, _ = self.patch({"store": "x"})
        self.assertEqual(status, 409)

    def test_change_between_check_and_write_is_a_409(self):
        self.h.table.update_item.side_effect = helpers.client_error("ConditionalCheckFailedException", "UpdateItem")
        status, _ = self.patch({"store": "x"})
        self.assertEqual(status, 409)

    def test_other_dynamodb_errors_become_500(self):
        self.h.table.update_item.side_effect = helpers.client_error("InternalServerError", "UpdateItem")
        status, _ = self.patch({"store": "x"})
        self.assertEqual(status, 500)


class DeleteReceiptTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.h.table.get_item.return_value = own_receipt()

    def delete(self):
        return self.call("DELETE /receipts/{id}", receipt_id=RECEIPT_ID)

    def test_row_and_photo_are_deleted(self):
        status, body = self.delete()
        self.assertEqual((status, body), (200, {"deleted": True}))
        kwargs = self.h.table.delete_item.call_args.kwargs
        self.assertEqual(kwargs["ConditionExpression"], "userId = :uid")
        self.assertEqual(kwargs["ExpressionAttributeValues"], {":uid": USER})
        self.h.s3.delete_object.assert_called_once_with(Bucket="bucket-test", Key=f"uploads/{RECEIPT_ID}.jpg")

    def test_someone_elses_receipt_is_untouched(self):
        self.h.table.get_item.return_value = own_receipt(userId=OTHER)
        status, _ = self.delete()
        self.assertEqual(status, 404)
        self.h.table.delete_item.assert_not_called()
        self.h.s3.delete_object.assert_not_called()

    def test_row_lost_to_a_race_is_404_and_the_photo_stays(self):
        self.h.table.delete_item.side_effect = helpers.client_error("ConditionalCheckFailedException", "DeleteItem")
        status, _ = self.delete()
        self.assertEqual(status, 404)
        self.h.s3.delete_object.assert_not_called()

    def test_failed_photo_delete_does_not_turn_the_answer_into_an_error(self):
        self.h.s3.delete_object.side_effect = helpers.client_error("AccessDenied", "DeleteObject")
        status, body = self.delete()
        self.assertEqual((status, body), (200, {"deleted": True}))

    def test_only_keys_in_the_uploads_folder_are_deleted_from_s3(self):
        self.h.table.get_item.return_value = own_receipt(imageKey="somewhere/else.jpg")
        self.delete()
        self.h.s3.delete_object.assert_not_called()


class BudgetTests(ApiTestCase):
    def test_no_budgets_yet(self):
        self.h.budgets_table.get_item.return_value = {}
        status, body = self.call("GET /budgets")
        self.assertEqual((status, body), (200, {"budgets": {}}))
        self.assertEqual(self.h.budgets_table.get_item.call_args.kwargs["Key"], {"userId": USER})

    def test_limits_are_merged_and_zero_removes_a_limit(self):
        self.h.budgets_table.get_item.return_value = {"Item": {"userId": USER, "limits": {"EUR": {"food": Decimal("100"), "bills": Decimal("30")}}}}
        status, body = self.call("PUT /budgets", body={"currency": "EUR", "limits": {"food": 0, "transport": 20.5, "bills": None}})
        self.assertEqual(status, 200)
        self.assertEqual(body["budgets"], {"EUR": {"transport": 20.5}})
        saved = self.h.budgets_table.put_item.call_args.kwargs["Item"]
        self.assertEqual(saved["userId"], USER)
        self.assertEqual(saved["limits"], {"EUR": {"transport": Decimal("20.5")}})

    def test_removing_the_last_limit_removes_the_currency(self):
        self.h.budgets_table.get_item.return_value = {"Item": {"userId": USER, "limits": {"EUR": {"food": Decimal("100")}}}}
        _, body = self.call("PUT /budgets", body={"currency": "EUR", "limits": {"food": None}})
        self.assertEqual(body["budgets"], {})

    def test_other_currencies_are_kept(self):
        self.h.budgets_table.get_item.return_value = {"Item": {"userId": USER, "limits": {"KZT": {"food": Decimal("50000")}}}}
        _, body = self.call("PUT /budgets", body={"currency": "EUR", "limits": {"food": 100}})
        self.assertEqual(set(body["budgets"]), {"KZT", "EUR"})

    def test_unknown_currency_label_question_mark_is_allowed(self):
        self.h.budgets_table.get_item.return_value = {}
        status, _ = self.call("PUT /budgets", body={"currency": "?", "limits": {"food": 10}})
        self.assertEqual(status, 200)

    def test_bad_input_is_refused_and_nothing_is_saved(self):
        bad_bodies = [
            {"currency": "euro", "limits": {"food": 10}},
            {"currency": "EUR"},
            {"currency": "EUR", "limits": {}},
            {"currency": "EUR", "limits": {"cars": 10}},
            {"currency": "EUR", "limits": {"food": -5}},
            {"currency": "EUR", "limits": {"food": "10"}},
            {"currency": "EUR", "limits": {"food": True}},
        ]
        for body in bad_bodies:
            status, _ = self.call("PUT /budgets", body=body)
            self.assertEqual(status, 400, body)
        self.h.budgets_table.put_item.assert_not_called()


class HelperTests(ApiTestCase):
    def test_is_amount(self):
        self.assertTrue(self.h.is_amount(0))
        self.assertTrue(self.h.is_amount(12.5))
        self.assertFalse(self.h.is_amount(True))
        self.assertFalse(self.h.is_amount("5"))
        self.assertFalse(self.h.is_amount(float("nan")))
        self.assertFalse(self.h.is_amount(float("inf")))
        self.assertFalse(self.h.is_amount(self.h.MAX_AMOUNT + 1))

    def test_to_money_rounds_to_cents_and_is_a_decimal(self):
        self.assertEqual(self.h.to_money(10.126), Decimal("10.13"))
        self.assertIsInstance(self.h.to_money(1), Decimal)

    def test_json_default_refuses_unknown_types(self):
        with self.assertRaises(TypeError):
            self.h.json_default(object())


if __name__ == "__main__":
    unittest.main()
