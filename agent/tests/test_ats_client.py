import httpx
import pytest
import respx

from ats_agent.ats_client import AtsApiError, AtsClient
from ats_agent.config import Settings


@respx.mock
def test_verify_access_token_calls_metadata(settings: Settings) -> None:
    route = respx.get("http://testserver/api/v1/resumes/metadata").mock(
        return_value=httpx.Response(
            200,
            json={"status": "success", "data": {"fileName": "cv.pdf"}},
        )
    )
    client = AtsClient(settings)
    client.verify_access_token("token123456789012345678901234567890")
    assert route.called
    assert route.calls[0].request.headers["Authorization"] == "Bearer token123456789012345678901234567890"
    client.close()


@respx.mock
def test_analyze_resume_posts_expected_body(settings: Settings) -> None:
    route = respx.post("http://testserver/api/v1/ai/analyze").mock(
        return_value=httpx.Response(
            201,
            json={"status": "success", "data": {"overallAtsScore": 80}},
        )
    )
    client = AtsClient(settings)
    data = client.analyze_resume(
        "token123456789012345678901234567890",
        target_job_title="Engineer",
    )
    assert data["overallAtsScore"] == 80
    assert route.calls[0].request.json() == {"targetJobTitle": "Engineer"}
    client.close()


@respx.mock
def test_match_job_posts_to_jobs_endpoint(settings: Settings) -> None:
    job_id = "507f1f77bcf86cd799439011"
    route = respx.post(f"http://testserver/api/v1/jobs/{job_id}/match").mock(
        return_value=httpx.Response(
            200,
            json={"status": "success", "data": {"overallMatchPercentage": 72}},
        )
    )
    client = AtsClient(settings)
    data = client.match_job("token123456789012345678901234567890", job_id)
    assert data["overallMatchPercentage"] == 72
    assert route.called
    client.close()


@respx.mock
def test_unauthorized_maps_to_error(settings: Settings) -> None:
    respx.get("http://testserver/api/v1/resumes/metadata").mock(
        return_value=httpx.Response(401, json={"status": "fail", "message": "Unauthorized"})
    )
    client = AtsClient(settings)
    with pytest.raises(AtsApiError, match="Invalid or expired"):
        client.verify_access_token("token123456789012345678901234567890")
    client.close()
