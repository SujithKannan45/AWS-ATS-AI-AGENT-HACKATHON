# ATS Strands Agent (Phase 1)

Minimal Python sidecar for the **Agent Experience Hackathon**: **Strands Decider 2B** (tool selection) + **Amazon Bedrock** (orchestration), calling your existing **Express ATS API** with the user's JWT.

## Architecture

1. Client sends `POST /v1/chat` with `Authorization: Bearer <access_token>` (same JWT as the MERN app).
2. Agent validates the token via `GET /api/v1/resumes/metadata` (user id comes from JWT on the server only).
3. **Decider 2B** runs a **choice** question (`analyze_resume` | `match_job` | `clarify`) — not an LLM.
4. **Strands Agent** on **Bedrock** replies and may call tools; `ToolSelectionHandler` enforces the Decider choice before each tool runs.
5. Tools call existing routes: `/ai/analyze`, `/jobs`, `/jobs/:id/match`. Resume scoring still uses **Gemini on the Express backend** (`GEMINI_API_KEY` in backend `.env` only).

Reusable hackathon asset: `src/ats_agent/decision_patterns/tool_selection.py`
Full reusable-pattern guide (typed questions, thresholds, confidence, intervention, fallback, reuse): [`docs/decision-patterns/tool-selection.md`](docs/decision-patterns/tool-selection.md)

Official references:

- [strands-labs/strands-decider](https://github.com/strands-labs/strands-decider) — `examples/strands/tool_call_intervention.py`, `_client.py`
- [Strands Bedrock provider](https://strandsagents.com/docs/user-guide/sdk/model-providers/amazon-bedrock/)

## Prerequisites (verify locally)

| Requirement | Notes |
|-------------|--------|
| Python 3.10+ | `python --version` |
| Node ATS backend | Running with MongoDB; `GEMINI_API_KEY` set in **backend** `.env` for analyze/match |
| `pip install strands-decider` | **Not** listed in `requirements.txt` (heavy torch stack). Install separately to run `strands-decider serve`. CLI verified on PyPI `strands-decider==0.1.0`. |
| AWS Bedrock access | Model access enabled for `BEDROCK_MODEL_ID` in `AWS_REGION`; credentials via `aws login` or standard env vars |
| Hugging Face | First `strands-decider serve` downloads model weights (network + disk) |

**Unverified in this repo:** exact compatible upper bound of `strands-agents` vs your Python version — pin adjusted if `pip` resolves conflicts.

## Windows setup

```powershell
cd agent
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
# Edit .env: ATS_API_BASE_URL, AWS_REGION, BEDROCK_MODEL_ID
```

### Terminal 1 — Express ATS (existing project)

```powershell
cd ..\backend
npm run dev
```

### Terminal 2 — Strands Decider 2B server

```powershell
pip install strands-decider
strands-decider serve StrandsAgents/strands-decider-2B-qwen3.5-v1-2610 --port 8099 --device cpu
```

Use `--device cpu` on Windows unless you have a supported GPU stack. Default URL: `http://127.0.0.1:8099` (`STRANDS_DECIDER_URL`).

### Terminal 3 — AWS credentials

```powershell
aws login
# Or: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN, AWS_REGION
```

Install `botocore[crt]` (in requirements) so Bedrock can reuse the CLI session when using `aws login`.

### Terminal 4 — Agent API

```powershell
cd agent
.\.venv\Scripts\Activate.ps1
$env:PYTHONPATH = "src"
python -m ats_agent.main
# Or: uvicorn ats_agent.main:app --host 127.0.0.1 --port 8080 --app-dir src
```

Service listens on `http://127.0.0.1:8080` by default.

## Smoke test

Obtain a JWT from the MERN app (login), then:

```powershell
curl.exe -X POST "http://127.0.0.1:8080/v1/chat" `
  -H "Authorization: Bearer YOUR_ACCESS_JWT" `
  -H "Content-Type: application/json" `
  -d "{\"message\":\"Analyze my resume for a backend engineer role\"}"
```

Response includes `decision.selected_tool`, `decision.confidence`, and `decision.latency_ms` from Decider.

## Tests (no AWS / Decider / MongoDB)

```powershell
cd agent
.\.venv\Scripts\Activate.ps1
pip install pytest pytest-asyncio respx httpx pydantic pydantic-settings fastapi
$env:PYTHONPATH = "src"
pytest
```

Unit tests mock HTTP and the agent factory; they do not invoke Bedrock or Decider.

## Environment variables

See `.env.example`. The Python service does **not** use `GEMINI_API_KEY`; configure Gemini only on the Express backend.

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Agent + Decider reachability |
| POST | `/v1/chat` | Body: `{ "message": "..." }`, header: `Authorization: Bearer <JWT>` |

## Related phases

- **Phase 2 — Express proxy:** the backend exposes `POST /api/v1/agent/chat` and forwards the verified JWT to this service. See [`../backend/README.md`](../backend/README.md#-ai-agent-chat-proxy-phase-2).
- **Phase 3 — Frontend:** the React AI Career Assistant lives at `/agent` ([`../frontend/src/pages/AgentChatPage.tsx`](../frontend/src/pages/AgentChatPage.tsx)).
- **Project overview, setup order, tests, and the 3-minute demo script:** [`../README.md`](../README.md).
