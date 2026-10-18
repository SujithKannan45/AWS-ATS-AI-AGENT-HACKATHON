from unittest.mock import MagicMock

from ats_agent.agent_service import AgentService, ChatResult
from ats_agent.config import Settings
from ats_agent.decision_patterns.tool_selection import ToolSelectionDecision


def test_run_chat_uses_mocked_decider_and_agent(settings: Settings) -> None:
    decider = MagicMock()
    decider.last_latency_ms = 50.0
    decider.ask.return_value = {
        "selected_tool": {"choice": "clarify", "confidence": 0.91}
    }

    ats = MagicMock()
    ats_client_factory = ats

    def agent_factory(handler, tools, cfg):
        agent = MagicMock()
        agent.return_value = "Clarifying question?"
        return agent

    service = AgentService(
        settings,
        ats_client=ats,
        decider=decider,
        agent_factory=agent_factory,
    )

    result = service.run_chat("help", "t" * 40)
    assert isinstance(result, ChatResult)
    assert result.decision.selected_tool == "clarify"
    ats.verify_access_token.assert_called_once()
