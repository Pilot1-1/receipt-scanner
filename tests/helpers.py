"""Shared test setup: loads the two Lambda handlers without any AWS account.

Both handlers are called "handler.py" and create AWS clients when they are imported, so
this module (1) sets the environment variables they read, (2) loads each file under its own
module name, and (3) lets every test replace the AWS objects (table, s3, ...) with mocks.
If boto3 is not installed (a bare machine), tiny stand-ins are used; with real boto3 installed
nothing is faked except the objects the tests replace.
"""
import importlib.util
import os
import sys
import types
from pathlib import Path
from unittest.mock import MagicMock

ROOT = Path(__file__).resolve().parent.parent

ENVIRONMENT = {
    "AWS_REGION": "eu-north-1",
    "AWS_DEFAULT_REGION": "eu-north-1",
    "AWS_ACCESS_KEY_ID": "testing",
    "AWS_SECRET_ACCESS_KEY": "testing",
    "TABLE_NAME": "receipts-test",
    "BUDGETS_TABLE": "budgets-test",
    "BUCKET_NAME": "bucket-test",
    "INDEX_NAME": "userId-createdAt-index",
    "GEMINI_MODEL": "test-model",
    "GEMINI_KEY_PARAM": "/receipt-scanner/test/gemini-api-key",
}


def _install_boto_stand_ins():
    """Just enough of boto3/botocore for the handlers to import and for tests to run."""
    boto3 = types.ModuleType("boto3")
    boto3.client = lambda *args, **kwargs: MagicMock()
    boto3.resource = lambda *args, **kwargs: MagicMock()

    dynamodb = types.ModuleType("boto3.dynamodb")
    conditions = types.ModuleType("boto3.dynamodb.conditions")

    class Key:
        def __init__(self, name):
            self.name = name

        def eq(self, value):
            return ("eq", self.name, value)

    conditions.Key = Key
    dynamodb.conditions = conditions
    boto3.dynamodb = dynamodb

    botocore = types.ModuleType("botocore")
    config = types.ModuleType("botocore.config")
    config.Config = lambda **kwargs: kwargs
    exceptions = types.ModuleType("botocore.exceptions")

    class ClientError(Exception):
        def __init__(self, error_response, operation_name):
            super().__init__(f"{operation_name}: {error_response}")
            self.response = error_response
            self.operation_name = operation_name

    exceptions.ClientError = ClientError
    botocore.config = config
    botocore.exceptions = exceptions

    sys.modules.update({
        "boto3": boto3,
        "boto3.dynamodb": dynamodb,
        "boto3.dynamodb.conditions": conditions,
        "botocore": botocore,
        "botocore.config": config,
        "botocore.exceptions": exceptions,
    })


os.environ.update(ENVIRONMENT)
try:
    import boto3  # noqa: F401
    import botocore  # noqa: F401
except ImportError:
    _install_boto_stand_ins()

from botocore.exceptions import ClientError  # noqa: E402  (real or stand-in, see above)


def client_error(code, operation="Test"):
    return ClientError({"Error": {"Code": code, "Message": code}}, operation)


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def api():
    """A freshly loaded API Lambda module, with mocks for its AWS objects.

    Loaded anew for every test, so a test that replaces a function cannot affect the next one.
    """
    module = _load("api_handler", ROOT / "src" / "api" / "handler.py")
    module.table = MagicMock(name="receipts_table")
    module.budgets_table = MagicMock(name="budgets_table")
    module.s3 = MagicMock(name="s3")
    return module


def processor():
    """A freshly loaded processor Lambda module, with mocks for its AWS objects."""
    processor_dir = str(ROOT / "src" / "processor")
    if processor_dir not in sys.path:
        sys.path.insert(0, processor_dir)  # the handler does "from gemini_client import ..."
    module = _load("processor_handler", ROOT / "src" / "processor" / "handler.py")
    module.table = MagicMock(name="receipts_table")
    module.s3 = MagicMock(name="s3")
    module.ssm = MagicMock(name="ssm")
    module.get_api_key = lambda: "test-key"
    return module


def gemini_client():
    processor_dir = str(ROOT / "src" / "processor")
    if processor_dir not in sys.path:
        sys.path.insert(0, processor_dir)
    import gemini_client as module
    return module
