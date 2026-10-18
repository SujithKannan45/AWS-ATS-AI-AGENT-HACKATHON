# AI-Powered ATS Resume Builder & Job Tracking Platform — Backend Foundation

Production-grade, enterprise backend foundation built with **Node.js, Express.js, TypeScript, and MongoDB (Mongoose)** following Clean Architecture, SOLID principles, and MVC design patterns.

---

## 🏛️ Architecture Overview

The backend uses a layered architecture separating concerns into distinct layers:

```
src/
├── config/             # Strongly-typed environment and database configuration
├── core/               # Cross-cutting foundational services
│   ├── errors/         # Centralized AppError hierarchy and global error handler
│   ├── logger/         # Structured Winston logger (Daily log rotation + Console)
│   └── middlewares/    # Security (Helmet, CORS, HPP, Mongo Sanitize), Morgan, Rate Limiting, Validation
├── modules/            # Vertical domain slices (e.g., Health, Auth, Resumes, AI, Jobs)
│   └── health/         # Diagnostic health check module (ALB/Kubernetes ready)
├── routes/             # Centralized versioned API route registry (/api/v1)
├── shared/             # Reusable abstractions & enterprise patterns
│   ├── repositories/   # Generic BaseRepository<T> (Repository Pattern)
│   ├── services/       # Generic BaseService<T> (Service Layer Pattern)
│   └── utils/          # Standardized JSend ApiResponse utility
├── app.ts              # Express application factory & middleware pipeline
└── server.ts           # Server bootstrap, DB lifecycle & graceful shutdown
```

---

## 📦 Prerequisites

* **Node.js**: `v20.0.0` or higher
* **MongoDB**: `v6.0+` (Local or MongoDB Atlas)
* **npm**: `v9.0.0+`

---

## 🚀 Installation & Setup

### 1. Install Dependencies

Run the following command in the `backend` directory:

```bash
npm install
```

#### Individual Package Install Commands (Reference):

```bash
# Core Production Dependencies
npm install express mongoose dotenv cors helmet compression morgan cookie-parser express-mongo-sanitize express-rate-limit hpp winston winston-daily-rotate-file zod

# Development Dependencies
npm install -D typescript tsx @types/node @types/express @types/cors @types/compression @types/morgan @types/cookie-parser @types/hpp prettier
```

### 2. Configure Environment Variables

Copy the `.env.example` file to `.env` and configure your settings:

```bash
cp .env.example .env
```

### 3. Run in Development Mode

```bash
npm run dev
```

### 4. Build and Run in Production

```bash
npm run build
npm start
```

---

## 🩺 Health Check API

| Route | Method | Description |
| :--- | :--- | :--- |
| `/health` | `GET` | Direct root probe for AWS ALB & Kubernetes |
| `/api/v1/health` | `GET` | Versioned API health diagnostic probe |

#### Sample Health Check Response:

```json
{
  "status": "success",
  "statusCode": 200,
  "message": "Service is operational",
  "data": {
    "service": "ATS Resume Platform Backend API",
    "status": "UP",
    "environment": "development",
    "timestamp": "2026-08-25T13:40:00.000Z",
    "uptimeSeconds": 42,
    "system": {
      "nodeVersion": "v20.14.0",
      "memoryUsageMB": {
        "rss": 54,
        "heapTotal": 28,
        "heapUsed": 19
      }
    },
    "dependencies": {
      "database": {
        "status": "CONNECTED",
        "readyState": 1,
        "host": "localhost",
        "databaseName": "ats_resume_platform"
      }
    }
  },
  "timestamp": "2026-08-25T13:40:00.000Z"
}
```

---

## 🤖 AI Agent Chat Proxy (Phase 2)

The backend proxies chat requests to the Python **Strands Decider** agent service (see `../agent`). Authentication
is enforced with the existing JWT middleware and the caller's verified `Authorization` header is forwarded
unchanged — the agent resolves the user identity from the JWT, so no client-supplied user ID is ever trusted.

| Route | Method | Description |
| :--- | :--- | :--- |
| `/api/v1/agent/chat` | `POST` | Authenticated proxy to the Python agent's `POST /v1/chat` |

**Request body:**

```json
{ "message": "Analyze my resume for a backend engineer role" }
```

**Success response (`data` mirrors the agent's contract):**

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
  "timestamp": "2026-08-25T13:40:00.000Z"
}
```

**Environment configuration:**

| Variable | Default | Description |
| :--- | :--- | :--- |
| `AGENT_SERVICE_URL` | `http://127.0.0.1:8080` | Base URL of the Python agent service |
| `AGENT_SERVICE_TIMEOUT_MS` | `60000` | Agent request timeout in milliseconds |

**Notes:**

* The endpoint is protected by `authenticate` and reuses the existing `aiRateLimiter`.
* Only the user's JWT is forwarded; AWS/Bedrock credentials live solely inside the Python agent process and are never exposed to the frontend.
* Upstream agent failures are mapped to safe HTTP responses (`400`/`401`/`403`/`404`/`429` passthrough, `502` unexpected, `503` unavailable, `504` timeout).

---

## 🛡️ Built-in Security & Resilience Features

* **Strict CORS Whitelist:** Dynamic origin validation from comma-separated environment variables.
* **Helmet Protection:** Secure HTTP headers with automated CSP configuration.
* **NoSQL Injection Defense:** Sanitization stripping `$` and `.` characters from incoming request payloads.
* **HTTP Parameter Pollution (HPP):** Protection against parameter tampering attacks.
* **Rate Limiting:** Sliding-window rate limiters with standardized `RateLimit-*` headers.
* **Graceful Shutdown:** Intercepts `SIGINT`, `SIGTERM`, and `unhandledRejection`, closing the HTTP server and disconnecting MongoDB cleanly.
