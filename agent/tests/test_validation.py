import pytest

from ats_agent.config import Settings
from ats_agent.validation import ValidationError, validate_chat_request


def test_validate_chat_request_success(settings: Settings) -> None:
    token = "a" * 40
    result = validate_chat_request(f"Bearer {token}", "Analyze my resume", settings)
    assert result.access_token == token
    assert result.message == "Analyze my resume"


def test_validate_missing_authorization(settings: Settings) -> None:
    with pytest.raises(ValidationError, match="Missing Authorization"):
        validate_chat_request(None, "hello", settings)


def test_validate_empty_message(settings: Settings) -> None:
    with pytest.raises(ValidationError, match="empty"):
        validate_chat_request("Bearer " + "x" * 30, "   ", settings)
