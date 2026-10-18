from __future__ import annotations

import logging
from typing import Any

import httpx

from ats_agent.config import Settings

logger = logging.getLogger(__name__)


class AtsApiError(Exception):
    """ATS backend returned an error or could not be reached."""

    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


class AtsClient:
    """Thin client for existing Express ATS routes (JWT identifies the user)."""

    def __init__(self, settings: Settings, client: httpx.Client | None = None) -> None:
        self._base = settings.ats_api_base_url.rstrip("/")
        self._timeout = settings.ats_http_timeout_seconds
        self._client = client or httpx.Client(timeout=self._timeout)

    def close(self) -> None:
        self._client.close()

    def _headers(self, access_token: str) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

    def _parse_success(self, response: httpx.Response) -> Any:
        try:
            payload = response.json()
        except ValueError as exc:
            raise AtsApiError("ATS API returned non-JSON response.") from exc

        status = payload.get("status")
        if response.status_code >= 400 or status in ("fail", "error"):
            message = payload.get("message") or response.reason_phrase or "ATS API error"
            raise AtsApiError(str(message), status_code=response.status_code)
        return payload.get("data")

    def verify_access_token(self, access_token: str) -> None:
        """Validate JWT by calling an authenticated read endpoint (no client user id)."""
        url = f"{self._base}/resumes/metadata"
        try:
            response = self._client.get(url, headers=self._headers(access_token))
        except httpx.RequestError as exc:
            logger.warning("ATS connectivity error during auth verify: %s", exc.__class__.__name__)
            raise AtsApiError("Could not reach ATS backend.") from exc

        if response.status_code == 401:
            raise AtsApiError("Invalid or expired access token.", status_code=401)
        self._parse_success(response)

    def get_current_resume_metadata(self, access_token: str) -> dict[str, Any]:
        url = f"{self._base}/resumes/metadata"
        response = self._client.get(url, headers=self._headers(access_token))
        if response.status_code == 401:
            raise AtsApiError("Invalid or expired access token.", status_code=401)
        return self._parse_success(response)

    def analyze_resume(
        self,
        access_token: str,
        *,
        target_job_title: str | None = None,
        job_description: str | None = None,
        resume_id: str | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {}
        if target_job_title:
            body["targetJobTitle"] = target_job_title
        if job_description:
            body["jobDescription"] = job_description
        if resume_id:
            body["resumeId"] = resume_id

        url = f"{self._base}/ai/analyze"
        response = self._client.post(url, headers=self._headers(access_token), json=body)
        if response.status_code == 401:
            raise AtsApiError("Invalid or expired access token.", status_code=401)
        return self._parse_success(response)

    def list_jobs(
        self,
        access_token: str,
        *,
        page: int = 1,
        limit: int = 10,
    ) -> list[dict[str, Any]]:
        url = f"{self._base}/jobs"
        response = self._client.get(
            url,
            headers=self._headers(access_token),
            params={"page": page, "limit": limit},
        )
        if response.status_code == 401:
            raise AtsApiError("Invalid or expired access token.", status_code=401)
        data = self._parse_success(response)
        if not isinstance(data, list):
            raise AtsApiError("Unexpected jobs list payload from ATS API.")
        return data

    def get_job(self, access_token: str, job_id: str) -> dict[str, Any]:
        url = f"{self._base}/jobs/{job_id}"
        response = self._client.get(url, headers=self._headers(access_token))
        if response.status_code == 401:
            raise AtsApiError("Invalid or expired access token.", status_code=401)
        if response.status_code == 404:
            raise AtsApiError("Job not found.", status_code=404)
        return self._parse_success(response)

    def match_job(self, access_token: str, job_id: str) -> dict[str, Any]:
        url = f"{self._base}/jobs/{job_id}/match"
        response = self._client.post(url, headers=self._headers(access_token), json={})
        if response.status_code == 401:
            raise AtsApiError("Invalid or expired access token.", status_code=401)
        if response.status_code == 404:
            raise AtsApiError("Job not found.", status_code=404)
        return self._parse_success(response)
