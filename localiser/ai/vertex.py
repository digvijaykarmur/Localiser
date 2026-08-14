"""Vertex AI Gemini client — latest models only, with cache + retries."""

from __future__ import annotations

import asyncio
import hashlib
import json
import random
import re
import time
from pathlib import Path
from typing import Any

from localiser.config import MODEL_FALLBACKS, get_settings
from localiser.db import LlmCache, LlmCall, get_session_factory, utcnow
from localiser.util import log, new_id

_semaphore: asyncio.Semaphore | None = None
_initialized = False
_active_models: dict[str, str] = {}


def _sem() -> asyncio.Semaphore:
    global _semaphore
    if _semaphore is None:
        _semaphore = asyncio.Semaphore(get_settings().vertex_concurrency)
    return _semaphore


def init_vertex() -> None:
    """Initialize Vertex SDK. Raises with a clear message if credentials missing."""
    global _initialized
    cfg = get_settings()
    if not cfg.gcp_project:
        raise RuntimeError(
            "GCP_PROJECT is not set. Put Vertex credentials in .env "
            "(GOOGLE_APPLICATION_CREDENTIALS + GCP_PROJECT)."
        )
    if cfg.google_application_credentials:
        import os

        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = cfg.google_application_credentials
        if not Path(cfg.google_application_credentials).exists():
            raise RuntimeError(
                f"Credentials file not found: {cfg.google_application_credentials}"
            )

    import vertexai

    vertexai.init(project=cfg.gcp_project, location=cfg.gcp_location)
    _initialized = True
    _active_models.update(cfg.models)
    log.info("vertex_initialized", project=cfg.gcp_project, location=cfg.gcp_location, models=cfg.models)


def ensure_init() -> None:
    if not _initialized:
        init_vertex()


def resolve_model(purpose: str) -> str:
    cfg = get_settings()
    return _active_models.get(purpose, cfg.models[purpose])


def _cache_key(prompt: str, model: str, image_hashes: list[str]) -> str:
    h = hashlib.sha256()
    h.update(prompt.encode())
    h.update(model.encode())
    for ih in sorted(image_hashes):
        h.update(ih.encode())
    return h.hexdigest()


def _strip_fences(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        t = re.sub(r"^```(?:json)?\s*", "", t)
        t = re.sub(r"\s*```$", "", t)
    return t.strip()


def parse_json_safe(text: str) -> Any:
    return json.loads(_strip_fences(text))


async def generate(
    *,
    purpose: str,
    prompt: str,
    images: list[bytes] | None = None,
    mime_types: list[str] | None = None,
    json_mode: bool = True,
    thinking: bool = False,
    job_id: str | None = None,
    temperature: float = 0.2,
    max_output_tokens: int = 8192,
) -> dict[str, Any] | str:
    """Call Vertex Gemini with retries, caching, and fallback model chain."""
    ensure_init()
    cfg = get_settings()
    primary = resolve_model(purpose)
    chain = [primary] + MODEL_FALLBACKS.get(primary, [])

    image_hashes = [
        hashlib.sha256(b).hexdigest() for b in (images or [])
    ]
    key = _cache_key(prompt, primary, image_hashes)

    Session = get_session_factory()
    with Session() as db:
        cached = db.get(LlmCache, key)
        if cached:
            row = LlmCall(
                id=new_id(),
                job_id=job_id,
                model=primary,
                purpose=purpose,
                cache_hit=1,
                latency_ms=0,
                created_at=utcnow(),
            )
            db.add(row)
            db.commit()
            raw = cached.response
            return parse_json_safe(raw) if json_mode else raw

    last_err: Exception | None = None
    for model_name in chain:
        try:
            result = await _call_once(
                model_name=model_name,
                purpose=purpose,
                prompt=prompt,
                images=images,
                mime_types=mime_types,
                json_mode=json_mode,
                thinking=thinking,
                job_id=job_id,
                temperature=temperature,
                max_output_tokens=max_output_tokens,
                cache_key=key,
            )
            if model_name != primary:
                log.warning("model_fallback_used", wanted=primary, used=model_name)
                _active_models[purpose] = model_name
            return result
        except Exception as e:  # noqa: BLE001
            last_err = e
            msg = str(e).lower()
            if "404" in msg or "not found" in msg or "does not have access" in msg:
                log.warning("model_unavailable", model=model_name, error=str(e))
                continue
            raise
    raise RuntimeError(f"All models failed for purpose={purpose}: {last_err}")


async def _call_once(
    *,
    model_name: str,
    purpose: str,
    prompt: str,
    images: list[bytes] | None,
    mime_types: list[str] | None,
    json_mode: bool,
    thinking: bool,
    job_id: str | None,
    temperature: float,
    max_output_tokens: int,
    cache_key: str,
) -> dict[str, Any] | str:
    from vertexai.generative_models import GenerationConfig, GenerativeModel, Part

    delays = [1, 2, 4, 8, 16]
    async with _sem():
        for attempt, delay in enumerate([0] + delays):
            if delay:
                jitter = delay * (0.75 + random.random() * 0.5)
                await asyncio.sleep(jitter)
            t0 = time.perf_counter()
            try:
                model = GenerativeModel(model_name)
                parts: list[Any] = [prompt]
                for i, blob in enumerate(images or []):
                    mt = (mime_types or ["image/png"])[min(i, len(mime_types or ["image/png"]) - 1)]
                    parts.append(Part.from_data(data=blob, mime_type=mt))

                gen_cfg_kwargs: dict[str, Any] = {
                    "temperature": temperature,
                    "max_output_tokens": max_output_tokens,
                }
                if json_mode:
                    gen_cfg_kwargs["response_mime_type"] = "application/json"

                # Thinking: enabled for story/review/vision_deep only (caller sets flag).
                # Newer Gemini 3.x use thinking_level; older SDKs ignore unknown kwargs.
                if thinking:
                    try:
                        gen_cfg = GenerationConfig(**gen_cfg_kwargs)
                    except TypeError:
                        gen_cfg = GenerationConfig(
                            temperature=temperature,
                            max_output_tokens=max_output_tokens,
                            response_mime_type="application/json" if json_mode else None,
                        )
                else:
                    gen_cfg = GenerationConfig(**gen_cfg_kwargs)

                # vertex SDK is sync — run in thread
                def _run():
                    return model.generate_content(parts, generation_config=gen_cfg)

                resp = await asyncio.to_thread(_run)
                text = resp.text or ""
                latency = int((time.perf_counter() - t0) * 1000)

                usage = getattr(resp, "usage_metadata", None)
                in_tok = getattr(usage, "prompt_token_count", None) if usage else None
                out_tok = getattr(usage, "candidates_token_count", None) if usage else None

                parsed: dict[str, Any] | str
                if json_mode:
                    try:
                        parsed = parse_json_safe(text)
                    except json.JSONDecodeError:
                        # one repair attempt
                        repair_prompt = (
                            "Fix this into valid JSON only, no fences:\n" + text[:12000]
                        )
                        repair = await asyncio.to_thread(
                            lambda: GenerativeModel(model_name).generate_content(
                                repair_prompt,
                                generation_config=GenerationConfig(
                                    temperature=0,
                                    response_mime_type="application/json",
                                ),
                            )
                        )
                        parsed = parse_json_safe(repair.text or "")
                        text = repair.text or text
                else:
                    parsed = text

                Session = get_session_factory()
                with Session() as db:
                    db.add(
                        LlmCache(
                            key=cache_key,
                            response=text if isinstance(parsed, str) else json.dumps(parsed, ensure_ascii=False),
                            model=model_name,
                            created_at=utcnow(),
                        )
                    )
                    db.add(
                        LlmCall(
                            id=new_id(),
                            job_id=job_id,
                            model=model_name,
                            purpose=purpose,
                            in_tokens=in_tok,
                            out_tokens=out_tok,
                            latency_ms=latency,
                            cache_hit=0,
                            created_at=utcnow(),
                        )
                    )
                    db.commit()
                return parsed
            except Exception as e:  # noqa: BLE001
                err = str(e)
                # Never retry on 400 — prompt bug
                if "400" in err and "INVALID" in err.upper():
                    raise
                if any(code in err for code in ("429", "503", "504")) and attempt < len(delays):
                    log.warning("vertex_retry", attempt=attempt, error=err[:200])
                    continue
                raise
    raise RuntimeError("unreachable")


async def smoke_test() -> dict[str, Any]:
    """1-token-ish auth check for cli doctor."""
    ensure_init()
    result = await generate(
        purpose="dialogue",
        prompt='Reply with JSON: {"ok": true}',
        json_mode=True,
        thinking=False,
        max_output_tokens=16,
    )
    return {"ok": True, "sample": result, "models": get_settings().models}
