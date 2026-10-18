from ats_agent.decision_patterns.tool_selection import (
    ALLOWED_STRANDS_TOOLS,
    apply_tool_selection_policy,
    build_tool_selection_state,
)


def test_build_tool_selection_state_includes_user_text() -> None:
    state = build_tool_selection_state("Match my resume to job abc")
    assert "Match my resume" in state


def test_apply_policy_accepts_high_confidence_choice() -> None:
    decision = apply_tool_selection_policy("analyze_resume", 0.9, 0.45)
    assert decision.tool == "analyze_resume"
    assert not decision.used_fallback


def test_apply_policy_falls_back_to_clarify_on_low_confidence() -> None:
    decision = apply_tool_selection_policy("match_job", 0.2, 0.45)
    assert decision.tool == "clarify"
    assert decision.used_fallback


def test_allowed_tools_for_match_includes_list() -> None:
    assert "list_tracked_jobs" in ALLOWED_STRANDS_TOOLS["match_job"]
