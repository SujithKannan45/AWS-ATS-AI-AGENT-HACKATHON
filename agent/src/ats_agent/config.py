from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    ats_api_base_url: str = Field(
        default="http://127.0.0.1:5000/api/v1",
        description="Base URL for the existing Express ATS API",
    )
    ats_http_timeout_seconds: float = Field(default=60.0, ge=5.0, le=300.0)

    aws_region: str = Field(default="us-east-1")
    bedrock_model_id: str = Field(
        default="us.anthropic.claude-haiku-4-5-20251001-v1:0",
        description="Bedrock model for agent orchestration (not for Decider decisions)",
    )

    strands_decider_url: str = Field(default="http://127.0.0.1:8099")
    tool_selection_min_confidence: float = Field(default=0.45, ge=0.0, le=1.0)

    agent_host: str = Field(default="127.0.0.1")
    agent_port: int = Field(default=8080, ge=1, le=65535)

    log_level: str = Field(default="INFO")
    skip_bedrock_startup_check: bool = Field(default=False)

    max_user_message_chars: int = Field(default=8000, ge=1, le=50000)


@lru_cache
def get_settings() -> Settings:
    return Settings()
