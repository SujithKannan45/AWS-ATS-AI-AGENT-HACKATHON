from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Request
from pydantic import BaseModel, Field

from ats_agent.agent_service import AgentService
from ats_agent.ats_client import AtsApiError
from ats_agent.config import Settings, get_settings
from ats_agent.decider_client import ServerUnavailable
from ats_agent.logging_setup import configure_logging
from ats_agent.validation import ValidationError, validate_chat_request

logger = logging.getLogger(__name__)


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=50000)


class DecisionResponse(BaseModel):
    pattern: str
    selected_tool: str
    confidence: float
    latency_ms: float | None = None
    raw_choice: str | None = None
    used_fallback: bool = False
    intervention_events: list[dict[str, Any]] = Field(default_factory=list)


class ChatResponse(BaseModel):
    reply: str
    decision: DecisionResponse


def create_app(settings: Settings | None = None, service: AgentService | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)
    agent_service = service or AgentService(settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.agent_service = agent_service
        yield
        if service is None:
            agent_service.close()

    app = FastAPI(
        title="ATS Strands Agent",
        version="0.1.0",
        description="Strands Decider 2B tool selection + Bedrock orchestration for ATS",
        lifespan=lifespan,
    )

    @app.get("/health")
    async def health() -> dict[str, Any]:
        svc: AgentService = app.state.agent_service
        decider_status: dict[str, Any] = {"status": "unknown"}
        try:
            decider_status = {"status": "up", **svc.check_decider()}
        except ServerUnavailable:
            decider_status = {"status": "down", "detail": "strands-decider server not reachable"}

        return {
            "status": "ok",
            "service": "ats-strands-agent",
            "decider": decider_status,
            "bedrock_model_id": settings.bedrock_model_id,
            "ats_api_base_url": settings.ats_api_base_url,
        }

    @app.post("/v1/chat", response_model=ChatResponse)
    async def chat(
        request: Request,
        body: ChatRequest,
        authorization: str | None = Header(default=None),
    ) -> ChatResponse:
        svc: AgentService = app.state.agent_service
        try:
            validated = validate_chat_request(authorization, body.message, settings)
        except ValidationError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        try:
            result = await asyncio.to_thread(
                svc.run_chat,
                validated.message,
                validated.access_token,
            )
        except AtsApiError as exc:
            status = exc.status_code or 502
            raise HTTPException(status_code=status, detail=str(exc)) from exc
        except ServerUnavailable as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except Exception as exc:
            logger.exception("Unhandled chat error")
            raise HTTPException(status_code=500, detail="Agent request failed.") from exc

        return ChatResponse(
            reply=result.reply,
            decision=DecisionResponse(
                pattern=result.decision.pattern,
                selected_tool=result.decision.selected_tool,
                confidence=result.decision.confidence,
                latency_ms=result.decision.latency_ms,
                raw_choice=result.decision.raw_choice,
                used_fallback=result.decision.used_fallback,
                intervention_events=result.decision.intervention_events,
            ),
        )

    return app


app = create_app()


def run() -> None:
    import uvicorn

    settings = get_settings()
    configure_logging(settings.log_level)
    uvicorn.run(
        "ats_agent.main:app",
        host=settings.agent_host,
        port=settings.agent_port,
        reload=False,
    )


if __name__ == "__main__":
    run()
