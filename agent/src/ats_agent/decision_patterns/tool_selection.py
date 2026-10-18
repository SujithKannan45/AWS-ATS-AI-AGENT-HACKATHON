"""
Reusable Strands Decider 2B **Tool Selection** pattern for ATS agents.

Drop-in: import QUESTIONS + resolve_tool_selection(), wire ToolSelectionHandler
in Agent(interventions=[...]) per strands-labs/strands-decider examples/strands/.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, Mapping

from ats_agent.decider_client import Decider

ToolChoice = Literal["analyze_resume", "match_job", "clarify"]

TOOL_SELECTION_QUESTION_KEY = "selected_tool"

TOOL_SELECTION_QUESTIONS: Mapping[str, dict[str, Any]] = {
    TOOL_SELECTION_QUESTION_KEY: Decider.choice(
        "Which ATS agent tool should handle this user request next?",
        {
            "analyze_resume": (
                "User wants ATS resume scoring, section feedback, keyword gaps, "
                "or optimization against a role or job description."
            ),
            "match_job": (
                "User wants to compare their resume against a specific tracked job "
                "opening (by id, company/title, or explicit match request)."
            ),
            "clarify": (
                "Intent is ambiguous or missing required details; the assistant should "
                "ask a clarifying question instead of running analyze or match yet."
            ),
        },
    ),
}

# Maps Decider choice → Strands @tool function names allowed for this turn.
ALLOWED_STRANDS_TOOLS: Mapping[ToolChoice, frozenset[str]] = {
    "analyze_resume": frozenset({"analyze_resume"}),
    "match_job": frozenset({"match_job", "list_tracked_jobs", "get_tracked_job"}),
    "clarify": frozenset(),
}


def build_tool_selection_state(user_message: str) -> str:
    return (
        "A candidate is using an AI-powered ATS resume and job tracking platform.\n\n"
        f"--- USER MESSAGE ---\n{user_message.strip()}\n"
    )


@dataclass(frozen=True)
class ToolSelectionDecision:
    """Outcome of Decider tool selection (policy applied in Python, not LLM)."""

    tool: ToolChoice
    confidence: float
    latency_ms: float | None
    raw_choice: str | None
    used_fallback: bool = False


def _parse_choice_answer(answer: dict[str, Any]) -> tuple[str | None, float]:
    """Parse choice payload from /v1/systemone answers."""
    if "choice" in answer:
        choice = str(answer["choice"])
        confidence = float(answer.get("confidence", 0.0))
        return choice, confidence
    if "noul" in answer:
        return None, float(answer["noul"])
    return None, 0.0


def apply_tool_selection_policy(
    raw_choice: str | None,
    confidence: float,
    min_confidence: float,
) -> ToolSelectionDecision:
    valid: frozenset[str] = frozenset({"analyze_resume", "match_job", "clarify"})
    tool: ToolChoice = "clarify"
    used_fallback = False

    if raw_choice in valid and confidence >= min_confidence:
        tool = raw_choice  # type: ignore[assignment]
    elif raw_choice in valid:
        used_fallback = True
        tool = "clarify"
    else:
        used_fallback = True
        tool = "clarify"

    return ToolSelectionDecision(
        tool=tool,
        confidence=confidence,
        latency_ms=None,
        raw_choice=raw_choice,
        used_fallback=used_fallback,
    )


def resolve_tool_selection(
    decider: Decider,
    user_message: str,
    min_confidence: float,
) -> ToolSelectionDecision:
    state = build_tool_selection_state(user_message)
    answers = decider.ask(state, TOOL_SELECTION_QUESTIONS)
    answer = answers.get(TOOL_SELECTION_QUESTION_KEY, {})
    raw_choice, confidence = _parse_choice_answer(answer)
    decision = apply_tool_selection_policy(raw_choice, confidence, min_confidence)
    return ToolSelectionDecision(
        tool=decision.tool,
        confidence=decision.confidence,
        latency_ms=decider.last_latency_ms,
        raw_choice=decision.raw_choice,
        used_fallback=decision.used_fallback,
    )
