from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    workspace: Path = Field(Path("./workspace"), validation_alias="LOCALISER_WORKSPACE")
    gcp_project: str | None = Field(None, validation_alias="GCP_PROJECT")
    gcp_location: str = Field("asia-south1", validation_alias="GCP_LOCATION")
    credentials: Path | None = Field(
        None, validation_alias="GOOGLE_APPLICATION_CREDENTIALS"
    )
    model_vision_bulk: str = "gemini-2.5-flash"
    model_vision_deep: str = "gemini-2.5-pro"
    model_story: str = "gemini-2.5-pro"
    model_dialogue: str = "gemini-2.5-flash"
    model_review: str = "gemini-2.5-pro"

    @property
    def database_url(self) -> str:
        return f"sqlite:///{(self.workspace / 'localiser.db').resolve()}"

    def ensure_workspace(self) -> None:
        for name in ("input", "projects", "output", "logs"):
            (self.workspace / name).mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.ensure_workspace()
    return settings
