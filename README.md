# AI-Powered ATS Resume Builder & Job Tracker — AWS Agent Experience Hackathon

A full-stack ATS platform (React + TypeScript SPA, Express + TypeScript API, MongoDB) extended with an **AI Career Assistant** built on **Strands Agents** and **Strands Decider 2B**.

The agent uses **Strands Decider 2B to make the tool-selection decision** (a small, explainable "decider" model) and **Amazon Bedrock to generate the natural-language answer** and orchestrate tool calls. The Express API remains the only service that talks to MongoDB and Gemini; AWS credentials stay server-side in the Python agent process and are never sent to the browser.

> **Verification status (read this first).** Locally verified: the Express backend test suite (9 suites / 48 tests), the backend `tsc` build, and the frontend `lint` + `build`. **Not locally verified:** the Python agent test suite (its dependencies are not installed in this workspace), and any behavior that needs live AWS Bedrock, a running Strands Decider server, or MongoDB. See [Testing & verification status](#-testing--verification-status).

---

## Table of contents

- [Purpose](#-purpose)
- [Architecture](#-architecture)
- [Features](#-features)
- [Decision pattern (Strands Decider 2B — Tool Selection)](#-decision-pattern-strands-decider-2b--tool-selection)
- [API contracts](#-api-contracts)
- [Authenticated request flow](#-authenticated-request-flow)
- [Prerequisites](#-prerequisites)
- [Environment configuration](#-environment-configuration)
- [Windows setup](#-windows-setup)
- [Service startup order](#-service-startup-order)
- [Testing & verification status](#-testing--verification-status)
- [3-minute hackathon demo script](#-3-minute-hackathon-demo-script)
- [Troubleshooting](#-troubleshooting)
- [Security notes](#-security-notes)
- [Official Strands Decider references](#-official-strands-decider-references)
- [Repository layout](#-repository-layout)
- [License](#-license)

---

## 🎯 Purpose

Candidates upload resumes, run ATS/Gemini analysis, track job applications, and now can talk to an **AI Career Assistant** in natural language ("Analyze my resume for a backend role", "Match me to my Senior React role"). The assistant is deliberately split across two AI systems:

| System | Role | Where it runs |
| :--- | :--- | :--- |
| **Strands Decider 2B** | Chooses **which tool** handles the request (the *decision*): `analyze_resume`, `match_job`, or `clarify` | Local Decider server (`strands-decider serve`) |
| **Amazon Bedrock** | Generates the **reply** and drives orchestration/tool calls | AWS (called from the Python agent) |
| **Google Gemini** | Produces ATS scoring / job-match numbers for the underlying ATS routes | Express backend (server-side key) |

The Decider decision is enforced in Python **before any tool runs** (see [Decision pattern](#-decision-pattern-strands-decider-2b--tool-selection)), so Bedrock cannot call a tool the Decider did not allow for the turn.

---

## 🏛️ Architecture

```
┌────────────────────────────┐
│  React + TS SPA (Vite)     │  /agent (AI Career Assistant chat UI)
│  localhost:5173            │  axios + JWT interceptor, TanStack Query
└─────────────┬──────────────┘
              │ POST /api/v1/agent/chat  { message }   (Authorization: Bearer <JWT>)
              ▼
┌────────────────────────────┐
│  Express + TS API          │  modules/agent  → authenticate → validate → proxy
│  localhost:5000            │  MongoDB (Mongoose) · Gemini ATS/match · jobs · resumes
└─────────────┬──────────────┘
              │ POST /v1/chat  { message }   (Authorization: Bearer <JWT> forwarded)
              ▼
┌────────────────────────────┐        ┌───────────────────────────┐
│  Python Agent (FastAPI)    │───────▶│  Strands Decider 2B       │
│  localhost:8080            │ decide │  localhost:8099           │
│  Strands Agent + Tools     │◀───────│  /v1/systemone (choice)   │
└─────────────┬──────────────┘        └───────────────────────────┘
              │ generate + tool calls
              ▼
        Amazon Bedrock  ──▶  ATS tools call back into Express
                             (GET /resumes/metadata, POST /ai/analyze,
                              GET /jobs, GET /jobs/:id, POST /jobs/:id/match)
```

- Backend details: [`backend/README.md`](backend/README.md)
- Agent details & Windows commands: [`agent/README.md`](agent/README.md)
- Frontend details: [`frontend/README.md`](frontend/README.md)
- Reusable pattern guide: [`agent/docs/decision-patterns/tool-selection.md`](agent/docs/decision-patterns/tool-selection.md)

---

## ✨ Features

**ATS platform (existing, preserved)**
1. Public SaaS landing, registration, email verification, password reset.
2. JWT access tokens + HTTP-only refresh token rotation with a silent-refresh queue.
3. Resume vault: drag-and-drop PDF/DOC/DOCX upload, Cloudinary storage, version history.
4. Interactive resume builder with ATS templates and PDF export.
5. Gemini ATS analysis: overall score (0–100) plus keyword/formatting/relevance breakdown and scan history.
6. Job tracker: Kanban + list views, statuses, priorities, reminders.
7. AI resume-to-job matching (Gemini) with matched vs missing skills.
8. Analytics dashboards, notifications hub, profile & BYOK settings.

**AI Career Assistant (this hackathon)**
9. Natural-language chat UI at `/agent` with empty/loading/error states and suggested prompts that reuse your active resume and tracked jobs.
10. Displays the **selected decision tool**, **confidence**, decision `pattern`, latency, and fallback flag returned by the backend — for explainability during the demo.
11. Streaming-free request/response chat via `POST /api/v1/agent/chat`, authenticated with the existing JWT client.

---

## 🧩 Decision pattern (Strands Decider 2B — Tool Selection)

A reusable pattern is implemented in [`agent/src/ats_agent/decision_patterns/tool_selection.py`](agent/src/ats_agent/decision_patterns/tool_selection.py) and enforced by [`ToolSelectionHandler`](agent/src/ats_agent/interventions/tool_selection_handler.py).

**Typed question + choices.** The Decider is asked a single `choice` question keyed `selected_tool`:

| Choice | Meaning |
| :--- | :--- |
| `analyze_resume` | User wants ATS scoring / section feedback / keyword gaps / optimization. |
| `match_job` | User wants to compare their resume against a specific tracked job. |
| `clarify` | Intent is ambiguous or missing details; ask a clarifying question first. |

**Decision thresholds & confidence.** `apply_tool_selection_policy` accepts the Decider choice only when the choice is valid **and** `confidence >= TOOL_SELECTION_MIN_CONFIDENCE` (default `0.45`, configurable via `TOOL_SELECTION_MIN_CONFIDENCE`). Confidence is a probability in `0..1`.

**Fallback behavior.** If the choice is invalid or below threshold, the pattern falls back to `clarify` and sets `used_fallback = true`. No tool runs.

**Allowed tools per choice** (`ALLOWED_STRANDS_TOOLS`):

| Choice | Allowed Strands tools |
| :--- | :--- |
| `analyze_resume` | `analyze_resume` |
| `match_job` | `match_job`, `list_tracked_jobs`, `get_tracked_job` |
| `clarify` | *(none)* |

**Intervention behavior.** Before each tool call, `ToolSelectionHandler.before_tool_call` returns:
- `Proceed()` when the proposed tool is allowed → logged with verdict `proceeded`.
- `Guide(feedback)` when the tool is blocked (clarify, or a non-allowed tool) → logged with verdict `guided`, and Bedrock is instructed to ask for missing details instead.

Each verdict is surfaced to the client as `decision.intervention_events[]`.

**How another developer can reuse it.** See the full guide: [`agent/docs/decision-patterns/tool-selection.md`](agent/docs/decision-patterns/tool-selection.md).

---

## 🔌 API contracts

### Python agent (FastAPI, `agent`)

| Method | Path | Body | Notes |
| :--- | :--- | :--- | :--- |
| `POST` | `/v1/chat` | `{ "message": string }` | Requires `Authorization: Bearer <JWT>` |
| `GET` | `/health` | — | Reports Decider reachability, `bedrock_model_id`, `ats_api_base_url` |

`POST /v1/chat` request/response:

```json
// request
{ "message": "Analyze my resume for a backend engineer role" }
```

```json
// 200 response
{
  "reply": "Your resume scores 78/100 ...",
  "decision": {
    "pattern": "tool_selection",
    "selected_tool": "analyze_resume",
    "confidence": 0.92,
    "latency_ms": 34.5,
    "raw_choice": "analyze_resume",
    "used_fallback": false,
    "intervention_events": []
  }
}
```

Agent error statuses: `400` invalid input, `401` invalid/expired JWT (verified against the ATS), `502` upstream ATS error, `503` Decider unavailable, `500` unexpected.

### Express backend (`backend`)

| Method | Path | Body | Notes |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/agent/chat` | `{ "message": string }` | Protected; reuses `authenticate` + `aiRateLimiter` |

The backend wraps successful agent responses in the platform envelope and returns the agent's `data` verbatim:

```json
{
  "status": "success",
  "statusCode": 200,
  "message": "AI agent response generated successfully",
  "data": {
    "reply": "...",
    "decision": {
      "pattern": "tool_selection",
      "selected_tool": "analyze_resume",
      "confidence": 0.92,
      "latency_ms": 34.5,
      "raw_choice": "analyze_resume",
      "used_fallback": false,
      "intervention_events": []
    }
  },
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

Upstream failures are mapped to safe HTTP statuses: `400`/`401`/`403`/`404`/`429` passthrough, `502` unexpected, `503` unavailable, `504` timeout. Client-supplied user IDs are stripped; only `message` is forwarded.

### Frontend (`frontend`)

[`agentService.chat(message)`](frontend/src/services/agent.service.ts) posts to `/agent/chat` through the shared authenticated axios client (base URL `VITE_API_URL`, default `/api/v1`) and returns `ApiResponse<IAgentChatResponse>.data`.

---

## 🔐 Authenticated request flow

1. The user logs in; the SPA stores the access token (Zustand) and the browser holds the HTTP-only refresh cookie.
2. The axios request interceptor attaches `Authorization: Bearer <accessToken>` automatically.
3. Express `authenticate` verifies the JWT and attaches `req.user`; the agent proxy forwards the **same** `Authorization` header unchanged.
4. The Python agent re-verifies the token by calling `GET /api/v1/resumes/metadata`; the user identity is derived from the JWT server-side — a client-supplied user id is never trusted.
5. Tools reuse the token via a `ContextVar`; the raw token is never logged or returned to the browser.

---

## 📋 Prerequisites

| Requirement | Version / notes |
| :--- | :--- |
| Node.js | `v20.0.0+` |
| npm | `v9.0.0+` |
| MongoDB | `v6.0+` (local or Atlas) |
| Python | `3.10+` (agent) |
| Google Gemini API key | Required by the backend for resume analysis / job match (`GEMINI_API_KEY`) |
| AWS account + Bedrock model access | For the real agent turn (`BEDROCK_MODEL_ID` in `AWS_REGION`) |
| `strands-decider` | Installed separately (`pip install strands-decider`); not in `agent/requirements.txt` (heavy torch stack). First `serve` downloads model weights. |

---

## ⚙️ Environment configuration

Copy each `.env.example` to `.env` (secrets are **not** committed; `.env` is git-ignored):

| File | Key variables |
| :--- | :--- |
| `backend/.env` | `MONGODB_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `COOKIE_SECRET`, `GEMINI_API_KEY`, `CLOUDINARY_*`, `SMTP_*`, `AGENT_SERVICE_URL`, `AGENT_SERVICE_TIMEOUT_MS` |
| `agent/.env` | `ATS_API_BASE_URL`, `AWS_REGION`, `BEDROCK_MODEL_ID`, `STRANDS_DECIDER_URL`, `TOOL_SELECTION_MIN_CONFIDENCE`, `AGENT_HOST`, `AGENT_PORT` |
| `frontend/.env` | `VITE_API_URL` (default `/api/v1`) |

Key agent/backend coupling variables:

| Variable | Default | Used by | Purpose |
| :--- | :--- | :--- | :--- |
| `AGENT_SERVICE_URL` | `http://127.0.0.1:8080` | backend | Base URL of the Python agent |
| `AGENT_SERVICE_TIMEOUT_MS` | `60000` | backend | Agent proxy timeout |
| `AGENT_PORT` | `8080` | agent | Agent listen port (must match `AGENT_SERVICE_URL`) |
| `STRANDS_DECIDER_URL` | `http://127.0.0.1:8099` | agent | Decider server base URL |
| `TOOL_SELECTION_MIN_CONFIDENCE` | `0.45` | agent | Decision confidence threshold |

> All example files contain **placeholders only**. Never commit a populated `.env`, and never place AWS/Bedrock values in the frontend.

---

## 🪟 Windows setup

```powershell
# 1. Backend
cd backend
npm install
Copy-Item .env.example .env     # then edit .env (Mongo URI, JWT secrets, GEMINI_API_KEY, etc.)

# 2. Frontend
cd ..\frontend
npm install
Copy-Item .env.example .env

# 3. Python agent
cd ..\agent
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
# strands-decider is installed separately (heavy):
pip install strands-decider
Copy-Item .env.example .env     # then edit .env (ATS_API_BASE_URL, AWS_REGION, BEDROCK_MODEL_ID)
```

See [`agent/README.md`](agent/README.md) for the agent's detailed terminal-by-terminal commands.

---

## ▶️ Service startup order

1. **MongoDB** — running locally or reachable via Atlas.
2. **Express backend** — `cd backend; npm run dev` → `http://localhost:5000`.
3. **Strands Decider server** — `strands-decider serve <model> --port 8099 --device cpu` → `http://127.0.0.1:8099`.
4. **AWS credentials** — export `AWS_*` env vars or run `aws login` (the agent needs them for Bedrock).
5. **Python agent** — `cd agent; .\.venv\Scripts\Activate.ps1; $env:PYTHONPATH="src"; python -m ats_agent.main` → `http://127.0.0.1:8080`.
6. **Frontend** — `cd frontend; npm run dev` → `http://localhost:5173` (Vite proxies `/api` → `localhost:5000`).

Verify the agent is wired up before demoing:

```powershell
curl.exe http://127.0.0.1:8080/health
# Expect "decider": { "status": "up", ... } and the configured bedrock_model_id
```

---

## ✅ Testing & verification status

### Locally verified (this workspace)

```powershell
cd backend
npm test        # 9 suites / 48 tests — passed
npm run build   # tsc — passed

cd ..\frontend
npm run lint    # oxlint — no errors in source
npm run build   # tsc -b && vite build — passed
```

The backend integration test [`agent.api.test.ts`](backend/tests/integration/agent.api.test.ts) mocks `fetch`, so it exercises auth, validation, JWT forwarding, and error mapping (`400/401/429/502/503/504`) **without** AWS, MongoDB, or a running Decider.

### Present but not locally verified

**Python agent tests** (`agent/tests/`: `test_api.py`, `test_agent_service_decider.py`, `test_tool_selection_policy.py`, `test_validation.py`, `test_ats_client.py`). They mock HTTP and the agent factory and do **not** need Bedrock/Decider/MongoDB, but they were **not executed here** because `pytest`, `fastapi`, and `strands` are not installed in this workspace. Run them yourself:

```powershell
cd agent
.\.venv\Scripts\Activate.ps1
pip install pytest pytest-asyncio respx httpx pydantic pydantic-settings fastapi
$env:PYTHONPATH = "src"
pytest
```

### Requires live services / credentials (not verified here)

- A real Strands Decider tool-selection decision (needs the Decider server + model weights).
- A real Amazon Bedrock generation turn (needs AWS credentials + model access).
- End-to-end chat through the browser (needs MongoDB + all four services running).

No test result above was fabricated; anything not executed is labelled as such.

---

## 🎬 3-minute hackathon demo script

Target: a **real Decider decision**, a **real agent reply**, and the resulting **ATS workflow** — under three minutes.

Pre-flight (before the timer): Mongo, backend, Decider, AWS creds, agent, and frontend are all up; you are logged in with at least one resume uploaded and one job tracked.

| Time | Action | What the audience sees |
| :--- | :--- | :--- |
| 0:00–0:20 | Open **AI Career Assistant** (`/agent`) from the sidebar. | Empty state with suggested prompts built from your resume + tracked jobs. |
| 0:20–0:45 | Show `http://127.0.0.1:8080/health` in a terminal. | The **Decider is "up"** and the Bedrock model id — separating the two AI systems. |
| 0:45–1:30 | Click **"Analyze my resume"** suggested prompt. | Loading indicator, then a reply plus the **Agent Decision** panel: `selected_tool=analyze_resume`, **confidence**, pattern, latency. |
| 1:30–2:05 | Send *"Match me to my `<Job Title>` role"*. | `selected_tool=match_job`, confidence, and a tool-grounded match summary. Mention `intervention_events` (which tools were allowed). |
| 2:05–2:30 | Switch to **AI Analysis / Job Tracker**. | The same underlying ATS records reflect the analysis/match — this is the *workflow*, not a mock. |
| 2:30–2:45 | In the terminal, note the Decider answered the `choice` question while Bedrock wrote the reply. | The core hackathon claim: **Decider decides, Bedrock generates.** |
| 2:45–3:00 | Close on the `used_fallback`/`clarify` behavior (ask something vague to show it). | Safe, explainable fallback when intent is unclear. |

Talk track: "The small Decider 2B model picks the tool with a confidence score; Strands agents on Bedrock do the language work. If confidence is low, Python blocks tool execution and the assistant asks a clarifying question instead."

---

## 🧯 Troubleshooting

| Symptom | Likely cause | Fix |
| :--- | :--- | :--- |
| `503` from `/api/v1/agent/chat` | Agent not running / wrong `AGENT_SERVICE_URL` | Start the agent; confirm `/health` responds |
| `/health` shows `decider.status = "down"` | Decider server not running | `strands-decider serve … --port 8099`; check `STRANDS_DECIDER_URL` |
| `504` timeout on chat | Agent/Bedrock slower than `AGENT_SERVICE_TIMEOUT_MS` | Raise `AGENT_SERVICE_TIMEOUT_MS` (client already allows up to 90s) |
| `401` when chatting | Expired access token | The SPA auto-refreshes; re-login if refresh also fails |
| Decider hangs | Model weights downloading / CPU slow | First run downloads weights; use `--device cpu` on Windows |
| `502` unexpected | Bedrock or upstream ATS error | Check agent logs; verify `GEMINI_API_KEY` on the backend for analyze/match |
| Frontend can't reach API | Vite proxy target / backend down | Backend on `:5000`; `VITE_API_URL=/api/v1` |

---

## 🔒 Security notes

- AWS/Bedrock credentials and the agent's internal config live only in the Python process; the browser never receives them.
- The browser only calls same-origin Express routes; `Authorization` is attached by the shared axios interceptor.
- Only the verified JWT is forwarded; client-supplied user ids/roles are stripped by the validator.
- Upstream 5xx details are mapped to generic client messages; the raw token is never logged.
- `agent/.gitignore` and the root `.gitignore` exclude `.env`, virtualenvs, caches, and build artifacts.

> Note: in `NODE_ENV=development` the shared error handler may include a stack trace in responses. It contains no secrets and is omitted in production; leaving it unchanged is a deliberate scope decision.

---

## 🔗 Official Strands Decider references

- Strands Decider repository: [strands-labs/strands-decider](https://github.com/strands-labs/strands-decider)
  - Integration examples used here: `examples/strands/tool_call_intervention.py` and `examples/strands/_client.py`
- Strands Agents (framework): [strandsagents.com](https://strandsagents.com)
  - Amazon Bedrock model provider: [Bedrock provider docs](https://strandsagents.com/docs/user-guide/sdk/model-providers/amazon-bedrock/)
- Decider server package: `strands-decider` on PyPI (`strands-decider serve …`)

---

## 🗂️ Repository layout

```
MERN-ATS-PROJECT/
├── frontend/   React 19 + TS SPA (Vite). AI Career Assistant at src/pages/AgentChatPage.tsx
├── backend/    Express + TS API (MongoDB, Gemini, auth, jobs, resumes, agent proxy)
├── agent/      Python FastAPI + Strands Agents + Strands Decider 2B
│   └── docs/decision-patterns/tool-selection.md   Reusable pattern guide
├── README.md   ← you are here
└── LICENSE
```

---

## ✅ Submission checklist

Statuses reflect what is present **in this repository only**. Nothing below has been submitted, deployed, or published on your behalf.

| # | Requirement | Status | Notes / manual action |
| :-- | :-- | :-- | :-- |
| 1 | Public source repository | ⬜ Pending | Push this repo to a **public** GitHub repository. Working tree currently has uncommitted doc changes. |
| 2 | OSI-approved license | 🟡 Present, needs review | [`LICENSE`](LICENSE) is MIT. Replace the placeholder holder (see below) if you have a real name/team. |
| 3 | Builder Center article | ⬜ Pending | Write and publish the article on the AWS Builder Center; link this repo. Not created here. |
| 4 | Public demo video (< 3 min) | ⬜ Pending | Record using the [3-minute demo script](#-3-minute-hackathon-demo-script). Not recorded here. |
| 5 | Required hashtags | ⬜ Pending | Confirm the **exact** hashtags from the official hackathon page and use them; do not guess. |
| 6 | Live agent demonstration | ⬜ Pending | Requires AWS Bedrock access + a running Strands Decider server + MongoDB. Not verified in this workspace. |

**Exact manual action for the LICENSE placeholder.** The MIT [`LICENSE`](LICENSE) currently reads:

```
Copyright (c) 2026 The ATS AI Agent Hackathon Project Authors
```

Replace `The ATS AI Agent Hackathon Project Authors` with your real name or team name. It was **not** changed automatically because no real owner name was provided; license terms were left untouched.

---

## 📄 License

Released under the [MIT License](LICENSE) — an OSI-approved license suitable for a public hackathon repository.
