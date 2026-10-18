import re
from dataclasses import dataclass

from ats_agent.config import Settings

_BEARER_RE = re.compile(r"^Bearer\s+(\S+)\s*$", re.IGNORECASE)


@dataclass(frozen=True)
class ValidatedChatInput:
    message: str
    access_token: str


class ValidationError(ValueError):
    """Client input failed validation."""


def parse_authorization_header(authorization: str | None) -> str:
    if not authorization or not authorization.strip():
        raise ValidationError("Missing Authorization header. Use Bearer <access_token>.")

    match = _BEARER_RE.match(authorization.strip())
    if not match:
        raise ValidationError("Authorization must be a Bearer access token.")

    token = match.group(1)
    if len(token) < 20:
        raise ValidationError("Access token appears invalid.")
    return token


def validate_chat_message(message: str | None, settings: Settings) -> str:
    if message is None:
        raise ValidationError("message is required.")
    text = message.strip()
    if not text:
        raise ValidationError("message cannot be empty.")
    if len(text) > settings.max_user_message_chars:
        raise ValidationError(
            f"message exceeds maximum length ({settings.max_user_message_chars} characters)."
        )
    return text


def validate_chat_request(
    authorization: str | None,
    message: str | None,
    settings: Settings,
) -> ValidatedChatInput:
    token = parse_authorization_header(authorization)
    text = validate_chat_message(message, settings)
    return ValidatedChatInput(message=text, access_token=token)
