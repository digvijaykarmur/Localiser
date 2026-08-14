import asyncio
import json
import random
from pathlib import Path
from typing import Any

from .config import Settings, get_settings


class VertexUnavailable(RuntimeError):
    pass


class VertexClient:
    """Google Gen AI SDK wrapper for Vertex with bounded concurrency and retries."""

    def __init__(self, settings: Settings | None = None, concurrency: int = 6):
        self.settings = settings or get_settings()
        if not self.settings.gcp_project:
            raise VertexUnavailable("GCP_PROJECT is missing from .env")
        try:
            from google import genai
        except ImportError as exc:
            raise VertexUnavailable(
                "Vertex support is not installed. Run: pip install -e '.[vertex]'"
            ) from exc
        self._client = genai.Client(
            vertexai=True,
            project=self.settings.gcp_project,
            location=self.settings.gcp_location,
        )
        self._semaphore = asyncio.Semaphore(concurrency)

    async def generate_json(
        self,
        *,
        model: str,
        prompt: str,
        images: list[tuple[bytes, str]] | None = None,
        thinking: bool = False,
    ) -> Any:
        from google.genai import types

        parts: list[Any] = [types.Part.from_text(text=prompt)]
        for data, mime_type in images or []:
            parts.append(types.Part.from_bytes(data=data, mime_type=mime_type))
        config = types.GenerateContentConfig(
            response_mime_type="application/json",
            temperature=0.2,
            thinking_config=types.ThinkingConfig(
                thinking_budget=-1 if thinking else 0
            ),
        )
        async with self._semaphore:
            for attempt in range(5):
                try:
                    response = await self._client.aio.models.generate_content(
                        model=model, contents=parts, config=config
                    )
                    text = (response.text or "").strip()
                    if text.startswith("```"):
                        text = text.split("\n", 1)[1].rsplit("```", 1)[0]
                    return json.loads(text)
                except Exception as exc:
                    status = getattr(exc, "code", None)
                    if status not in {429, 503, 504} or attempt == 4:
                        raise
                    await asyncio.sleep((2**attempt) * random.uniform(0.75, 1.25))
        raise RuntimeError("unreachable")


def credentials_check(settings: Settings) -> tuple[bool, str]:
    credentials = settings.credentials
    if credentials is None:
        return False, "GOOGLE_APPLICATION_CREDENTIALS is not set"
    path = Path(credentials).expanduser()
    if not path.is_file():
        return False, f"credentials file not found: {path}"
    return True, f"credentials file exists: {path}"
