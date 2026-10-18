from __future__ import annotations

import json
import logging
from typing import Any

from strands import tool

from ats_agent.ats_client import AtsApiError, AtsClient
from ats_agent.request_context import get_bearer_token

logger = logging.getLogger(__name__)


def _safe_error_message(exc: AtsApiError) -> str:
    return str(exc)


def build_ats_tools(client: AtsClient) -> list[Any]:
    """Strands tools that delegate to the existing Express ATS API."""

    @tool
    def analyze_resume(
        target_job_title: str | None = None,
        job_description: str | None = None,
        resume_id: str | None = None,
    ) -> str:
        """
        Run ATS resume analysis via the platform backend (Gemini scoring on server).

        Args:
            target_job_title: Optional role title to optimize against.
            job_description: Optional job description text for match scoring.
            resume_id: Optional resume id; defaults to the user's active resume.
        """
        token = get_bearer_token()
        try:
            data = client.analyze_resume(
                token,
                target_job_title=target_job_title,
                job_description=job_description,
                resume_id=resume_id,
            )
            return json.dumps(data, default=str)
        except AtsApiError as exc:
            logger.warning("analyze_resume ATS error: %s", _safe_error_message(exc))
            return json.dumps({"error": _safe_error_message(exc)})

    @tool
    def list_tracked_jobs(limit: int = 10) -> str:
        """
        List the user's tracked job applications (ids, titles, companies).

        Args:
            limit: Maximum jobs to return (1-50).
        """
        token = get_bearer_token()
        bounded = max(1, min(int(limit), 50))
        try:
            jobs = client.list_jobs(token, page=1, limit=bounded)
            slim = [
                {
                    "id": j.get("id"),
                    "title": j.get("jobTitle"),
                    "company": j.get("companyName"),
                    "status": j.get("status"),
                }
                for j in jobs
            ]
            return json.dumps(slim, default=str)
        except AtsApiError as exc:
            return json.dumps({"error": _safe_error_message(exc)})

    @tool
    def get_tracked_job(job_id: str) -> str:
        """
        Fetch one tracked job by MongoDB id.

        Args:
            job_id: Job id from the user's job tracker.
        """
        token = get_bearer_token()
        try:
            data = client.get_job(token, job_id.strip())
            return json.dumps(data, default=str)
        except AtsApiError as exc:
            return json.dumps({"error": _safe_error_message(exc)})

    @tool
    def match_job(job_id: str) -> str:
        """
        AI-match the user's active resume to a tracked job (backend Gemini match).

        Args:
            job_id: Tracked job id to evaluate.
        """
        token = get_bearer_token()
        try:
            data = client.match_job(token, job_id.strip())
            return json.dumps(data, default=str)
        except AtsApiError as exc:
            return json.dumps({"error": _safe_error_message(exc)})

    return [analyze_resume, list_tracked_jobs, get_tracked_job, match_job]
