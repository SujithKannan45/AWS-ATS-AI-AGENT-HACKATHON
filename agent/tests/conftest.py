import pytest

from ats_agent.config import Settings


@pytest.fixture
def settings() -> Settings:
    return Settings(
        ats_api_base_url="http://testserver/api/v1",
        strands_decider_url="http://127.0.0.1:8099",
        tool_selection_min_confidence=0.45,
        max_user_message_chars=8000,
    )
