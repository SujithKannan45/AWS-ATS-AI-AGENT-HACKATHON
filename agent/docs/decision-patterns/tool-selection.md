# Reusable Pattern: Strands Decider 2B — Tool Selection

A drop-in pattern that lets a small **Strands Decider 2B** model choose *which tool* an agent should use for a turn, while a larger **Amazon Bedrock** model does the language generation. The decision is enforced in Python before any tool executes, so it is cheap, explainable, and testable.

- **Decider decides** → a typed `choice` question returns a tool label + confidence.
- **Bedrock generates** → the Strands `Agent` writes the reply and proposes tool calls.
- **Python enforces** → a `ToolSelectionHandler` allows or blocks each proposed tool.

Source of truth in this repo:

- Policy + question: [`src/ats_agent/decision_patterns/tool_selection.py`](../../src/ats_agent/decision_patterns/tool_selection.py)
- Enforcement: [`src/ats_agent/interventions/tool_selection_handler.py`](../../src/ats_agent/interventions/tool_selection_handler.py)
- Decider HTTP client: [`src/ats_agent/decider_client.py`](../../src/ats_agent/decider_client.py)
- Wiring: [`src/ats_agent/agent_service.py`](../../src/ats_agent/agent_service.py)

---

## 1. The decision question

The Decider is asked one question keyed `selected_tool`, of type `choice`, with three candidate labels and a description of when each applies:

| Choice | When it applies |
| :--- | :--- |
| `analyze_resume` | ATS scoring, section feedback, keyword gaps, optimization. |
| `match_job` | Compare the resume against a specific tracked job. |
| `clarify` | Intent ambiguous / missing details — ask a question instead of running a tool. |

```python
TOOL_SELECTION_QUESTION_KEY = "selected_tool"

TOOL_SELECTION_QUESTIONS = {
    TOOL_SELECTION_QUESTION_KEY: Decider.choice(
        "Which ATS agent tool should handle this user request next?",
        {
            "analyze_resume": "User wants ATS resume scoring, section feedback, keyword gaps, ...",
            "match_job": "User wants to compare their resume against a specific tracked job ...",
            "clarify": "Intent is ambiguous or missing required details ...",
        },
    ),
}
```

The `state` passed to the Decider is just the user message (plus a one-line context banner) — see `build_tool_selection_state`.

---

## 2. Confidence & the decision threshold

Confidence is a probability in `0..1`. `apply_tool_selection_policy` accepts the Decider's label only when it is a valid label **and** confidence meets the threshold:

```python
TOOL_SELECTION_MIN_CONFIDENCE   # default 0.45  (env: TOOL_SELECTION_MIN_CONFIDENCE)
```

| Decider output | Result |
| :--- | :--- |
| Valid label, `confidence >= min` | Use the label. `used_fallback = false`. |
| Valid label, `confidence < min` | Fall back to `clarify`. `used_fallback = true`. |
| Invalid / no label (`noul`) | Fall back to `clarify`. `used_fallback = true`. |

---

## 3. Allowed tools per choice

The pattern maps each decision to the Strands `@tool` names permitted for the turn:

```python
ALLOWED_STRANDS_TOOLS = {
    "analyze_resume": frozenset({"analyze_resume"}),
    "match_job":      frozenset({"match_job", "list_tracked_jobs", "get_tracked_job"}),
    "clarify":        frozenset(),  # no tools; ask the user instead
}
```

---

## 4. Intervention behavior (enforcement)

`ToolSelectionHandler` is registered as a Strands intervention on the `Agent`. Before every tool call it inspects the proposed tool:

| Situation | Handler returns | `verdict` logged |
| :--- | :--- | :--- |
| Decision is `clarify` | `Guide("...ask a clarifying question...")` | `guided` |
| Proposed tool not in the allowed set | `Guide("...use an allowed tool...")` | `guided` |
| Proposed tool allowed | `Proceed()` | `proceeded` |

Every entry is collected in `handler.log` and returned to the caller as `decision.intervention_events[]`, e.g.:

```json
{ "tool": "match_job", "selected_tool": "match_job", "allowed": true, "verdict": "proceeded" }
```

This is the key guarantee: **Bedrock cannot call a tool the Decider did not allow**, and the reason is observable.

---

## 5. Drop-in usage

### 5a. Ask the Decider and apply the policy

```python
from ats_agent.decider_client import Decider
from ats_agent.decision_patterns.tool_selection import resolve_tool_selection

decider = Decider(url="http://127.0.0.1:8099")      # env: STRANDS_DECIDER_URL
selection = resolve_tool_selection(decider, user_message, min_confidence=0.45)
# selection.tool, .confidence, .latency_ms, .raw_choice, .used_fallback
```

### 5b. Enforce it on the agent

```python
from strands import Agent
from strands.models import BedrockModel
from ats_agent.interventions.tool_selection_handler import ToolSelectionHandler

handler = ToolSelectionHandler(decision=selection)
agent = Agent(
    model=BedrockModel(model_id=BEDROCK_MODEL_ID, region_name=AWS_REGION),
    tools=my_tools,
    interventions=[handler],          # ← the enforcement hook
    system_prompt=MY_SYSTEM_PROMPT,
    callback_handler=None,
)
reply = str(agent(user_message))
```

### 5c. Reuse in a different domain

1. Copy `decision_patterns/tool_selection.py` and `interventions/tool_selection_handler.py`.
2. Replace the labels/descriptions in `TOOL_SELECTION_QUESTIONS` and the mapping in `ALLOWED_STRANDS_TOOLS` with your own tool set.
3. Keep the rest — `apply_tool_selection_policy` and `ToolSelectionHandler` are domain-agnostic.
4. Point `STRANDS_DECIDER_URL` at your Decider server and tune `TOOL_SELECTION_MIN_CONFIDENCE`.

---

## 6. Transport contract (Decider server)

`Decider.ask()` performs a single synchronous round trip:

```
POST {STRANDS_DECIDER_URL}/v1/systemone
Content-Type: application/json

{ "state": "<user message + context>",
  "model": "hobson-latest",
  "questions": { "selected_tool": { "type": "choice", "instructions": "...", "criteria": { ... } } } }
```

Response fields consumed: `answers` (keyed by question key) and `latency_ms`. Client timeout is 120s; the client uses only the Python standard library (`urllib`).

Question factories available: `Decider.choice(...)`, `Decider.noul(...)`, `Decider.score(...)`.

---

## 7. Configuration

| Env var | Default | Meaning |
| :--- | :--- | :--- |
| `STRANDS_DECIDER_URL` | `http://127.0.0.1:8099` | Decider server base URL |
| `TOOL_SELECTION_MIN_CONFIDENCE` | `0.45` | Minimum confidence to accept the decision |

---

## 8. Testing the pattern (no Decider/AWS needed)

- Pure policy: [`tests/test_tool_selection_policy.py`](../../tests/test_tool_selection_policy.py) covers high-confidence accept, low-confidence fallback, and the allowed-tools map.
- Mocked decider + agent: [`tests/test_agent_service_decider.py`](../../tests/test_agent_service_decider.py) drives `AgentService.run_chat` with a `MagicMock` Decider and agent factory.

These tests do not require the Decider server, Bedrock, or AWS credentials.

> Not verified in the current workspace: the Python test suite was not executed here (dependencies not installed). See the root README's "Testing & verification status".

---

## 9. Official references

- [strands-labs/strands-decider](https://github.com/strands-labs/strands-decider) — see `examples/strands/tool_call_intervention.py` and `examples/strands/_client.py`
- [Strands Agents documentation](https://strandsagents.com) — [Amazon Bedrock model provider](https://strandsagents.com/docs/user-guide/sdk/model-providers/amazon-bedrock/)
