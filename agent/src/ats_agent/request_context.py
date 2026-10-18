from contextvars import ContextVar, Token

_bearer_token: ContextVar[str | None] = ContextVar("bearer_token", default=None)


def set_bearer_token(token: str) -> Token:
    return _bearer_token.set(token)


def reset_bearer_token(token: Token) -> None:
    _bearer_token.reset(token)


def get_bearer_token() -> str:
    value = _bearer_token.get()
    if not value:
        raise RuntimeError("Authenticated request context is not set.")
    return value
