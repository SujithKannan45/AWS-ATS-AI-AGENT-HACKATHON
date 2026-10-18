from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from ats_agent.agent_service import AgentService, ChatDecisionPayload, ChatResult
from ats_agent.config import Settings
from ats_agent.main import create_app


@pytest.fixture
def test_client() -> TestClient:
    settings = Settings(ats_api_base_url="http://testserver/api/v1")
    mock_service = MagicMock(spec=AgentService)
    mock_service.check_decider.return_value = {"checkpoint": "test"}
    mock_service.run_chat.return_value = ChatResult(
        reply="Hello from agent",
        decision=ChatDecisionPayload(
            selected_tool="clarify",
            confidence=0.88,
            latency_ms=120.0,
            raw_choice="clarify",
        ),
    )
    app = create_app(settings=settings, service=mock_service)
    return TestClient(app)


def test_health(test_client: TestClient) -> None:
    response = test_client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_chat_requires_auth(test_client: TestClient) -> None:
    response = test_client.post("/v1/chat", json={"message": "Hi"})
    assert response.status_code == 400


def test_chat_success(test_client: TestClient) -> None:
    token = "b" * 40
    response = test_client.post(
        "/v1/chat",
        json={"message": "Analyze my resume"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["reply"] == "Hello from agent"
    assert body["decision"]["selected_tool"] == "clarify"
    assert body["decision"]["pattern"] == "tool_selection"
