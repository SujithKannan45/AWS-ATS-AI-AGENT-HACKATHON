from __future__ import annotations

import json
import logging
from strands.interventions import Guide, InterventionHandler, Proceed

from ats_agent.decision_patterns.tool_selection import (
    ALLOWED_STRANDS_TOOLS,
    ToolSelectionDecision,
)
from ats_agent.decider_client import NAME

logger = logging.getLogger(__name__)


class InterventionLogEntry:
    def __init__(self, tool: str, selected_tool: str, allowed: bool, verdict: str) -> None:
        self.tool = tool
        self.selected_tool = selected_tool
        self.allowed = allowed
        self.verdict = verdict


class ToolSelectionHandler(InterventionHandler):
    """
    Enforces Decider 2B tool selection before any ATS tool executes.

    Pattern: Tool Selection (hackathon) — Decider chooses; Python policy + Guide/Proceed.
    """

    name = f"{NAME}-ats-tool-selection"

    def __init__(self, decision: ToolSelectionDecision) -> None:
        self.decision = decision
        self.log: list[InterventionLogEntry] = []

    @staticmethod
    def _render_user_messages(messages: list[dict]) -> str:
        lines: list[str] = []
        for message in messages:
            if message.get("role") != "user":
                continue
            for block in message.get("content", []):
                if isinstance(block, dict) and "text" in block:
                    lines.append(block["text"])
        return "\n".join(lines) if lines else ""

    def before_tool_call(self, event, **kwargs):
        proposed = event.tool_use["name"]
        allowed_names = ALLOWED_STRANDS_TOOLS.get(self.decision.tool, frozenset())

        if self.decision.tool == "clarify":
            entry = InterventionLogEntry(
                tool=proposed,
                selected_tool=self.decision.tool,
                allowed=False,
                verdict="guided",
            )
            self.log.append(entry)
            logger.info(
                "Decider selected clarify; blocking tool %s (confidence=%.2f)",
                proposed,
                self.decision.confidence,
            )
            return Guide(
                feedback=(
                    "Do not call ATS tools yet. Ask the user a concise clarifying question "
                    "about whether they want resume analysis or job matching, and gather "
                    "any missing job title, job id, or job description."
                )
            )

        if proposed not in allowed_names:
            entry = InterventionLogEntry(
                tool=proposed,
                selected_tool=self.decision.tool,
                allowed=False,
                verdict="guided",
            )
            self.log.append(entry)
            logger.info(
                "Tool mismatch: proposed=%s decider=%s confidence=%.2f",
                proposed,
                self.decision.tool,
                self.decision.confidence,
            )
            return Guide(
                feedback=(
                    f"Strands Decider selected '{self.decision.tool}' for this turn "
                    f"(confidence {self.decision.confidence:.2f}). "
                    f"Use an allowed tool for that choice instead of '{proposed}', "
                    "or ask the user for missing details."
                )
            )

        arguments = event.tool_use.get("input") or {}
        logger.debug(
            "Proceeding with tool %s args=%s",
            proposed,
            json.dumps(arguments)[:500],
        )
        self.log.append(
            InterventionLogEntry(
                tool=proposed,
                selected_tool=self.decision.tool,
                allowed=True,
                verdict="proceeded",
            )
        )
        return Proceed()
