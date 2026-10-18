from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Callable

from strands import Agent
from strands.models import BedrockModel

from ats_agent.ats_client import AtsApiError, AtsClient
from ats_agent.config import Settings
from ats_agent.decider_client import Decider, ServerUnavailable
from ats_agent.decision_patterns.tool_selection import ToolSelectionDecision, resolve_tool_selection
from ats_agent.interventions.tool_selection_handler import ToolSelectionHandler
from ats_agent.request_context import reset_bearer_token, set_bearer_token
from ats_agent.tools.ats_tools import build_ats_tools

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are an ATS career assistant for a resume builder and job tracker.

Capabilities (via tools only):
- analyze_resume: ATS score and improvement suggestions
- list_tracked_jobs / get_tracked_job: find job ids
- match_job: compare resume to a tracked job

Rules:
- Prefer tools over guessing. Do not invent job ids or resume content.
- Summarize tool JSON for the user in clear, actionable language.
- If the user is vague, ask what they want: analysis vs job match, and any missing job details.
"""


@dataclass
class ChatDecisionPayload:
    pattern: str = "tool_selection"
    selected_tool: str = ""
    confidence: float = 0.0
    latency_ms: float | None = None
    raw_choice: str | None = None
    used_fallback: bool = False
    intervention_events: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class ChatResult:
    reply: str
    decision: ChatDecisionPayload


AgentFactory = Callable[[ToolSelectionHandler, list[Any]], Agent]


def default_agent_factory(handler: ToolSelectionHandler, tools: list[Any], settings: Settings) -> Agent:
    model = BedrockModel(
        model_id=settings.bedrock_model_id,
        region_name=settings.aws_region,
        temperature=0.2,
    )
    return Agent(
        model=model,
        tools=tools,
        interventions=[handler],
        system_prompt=SYSTEM_PROMPT,
        callback_handler=None,
    )


class AgentService:
    def __init__(
        self,
        settings: Settings,
        ats_client: AtsClient | None = None,
        decider: Decider | None = None,
        agent_factory: AgentFactory | None = None,
    ) -> None:
        self._settings = settings
        self._ats = ats_client or AtsClient(settings)
        self._decider = decider or Decider(url=settings.strands_decider_url)
        self._agent_factory = agent_factory

    def close(self) -> None:
        self._ats.close()

    def check_decider(self) -> dict[str, Any]:
        return self._decider.health()

    def run_chat(self, message: str, access_token: str) -> ChatResult:
        self._ats.verify_access_token(access_token)

        try:
            selection = resolve_tool_selection(
                self._decider,
                message,
                self._settings.tool_selection_min_confidence,
            )
        except ServerUnavailable as exc:
            logger.error("Decider unavailable: %s", exc)
            raise

        handler = ToolSelectionHandler(decision=selection)
        tools = build_ats_tools(self._ats)
        token_ctx = set_bearer_token(access_token)
        try:
            if self._agent_factory:
                agent = self._agent_factory(handler, tools, self._settings)
            else:
                agent = default_agent_factory(handler, tools, self._settings)

            logger.info(
                "Running Bedrock agent turn decider_tool=%s confidence=%.2f",
                selection.tool,
                selection.confidence,
            )
            agent_result = agent(message)
            reply_text = str(agent_result)
        finally:
            reset_bearer_token(token_ctx)

        decision_payload = ChatDecisionPayload(
            selected_tool=selection.tool,
            confidence=selection.confidence,
            latency_ms=selection.latency_ms,
            raw_choice=selection.raw_choice,
            used_fallback=selection.used_fallback,
            intervention_events=[
                {
                    "tool": e.tool,
                    "selected_tool": e.selected_tool,
                    "allowed": e.allowed,
                    "verdict": e.verdict,
                }
                for e in handler.log
            ],
        )
        return ChatResult(reply=reply_text, decision=decision_payload)

