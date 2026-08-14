"""Vertex AI (Gemini) client — §11.

Call discipline:
- global semaphore (default 6)
- exponential backoff on 429/503/504 (1s..16s, jitter ±25%, max 5); never retry 400
- response cache keyed on sha256(prompt + model + image hashes) → llm_cache table
- every call logged to llm_calls (cost/audit trail)
- thinking enabled only for story/review/vision_deep purposes
- images downscaled so max dim ≤ 1568px before sending
- model fallback chain for regional availability (strictly-latest defaults)
"""
from __future__ import annotations

import asyncio
import hashlib
import io
import json
import random
import re
import time
import uuid
from pathlib import Path

import structlog
from PIL import Image

from ..config import CFG, MODEL_FALLBACK_CHAIN, THINKING_PURPOSES
from ..db import LlmCache, LlmCall, session

log = structlog.get_logger()

MAX_IMG_DIM = 1568

_semaphore: asyncio.Semaphore | None = None
_initialized = False
_available_models: dict[str, str] = {}  # requested -> resolved


def _sem() -> asyncio.Semaphore:
    global _semaphore
    if _semaphore is None:
        _semaphore = asyncio.Semaphore(CFG.max_concurrency)
    return _semaphore


def init_vertex() -> None:
    global _initialized
    if _initialized:
        return
    import vertexai

    vertexai.init(project=CFG.gcp_project, location=CFG.gcp_location)
    _initialized = True
    log.info("vertex_init", project=CFG.gcp_project, location=CFG.gcp_location)


def resolve_model(model: str) -> str:
    """Return the requested model, or the first fallback that responds.

    Resolution is cached for the process lifetime. A 1-token probe is used;
    NOT_FOUND / PERMISSION errors trigger the fallback chain with a warning.
    """
    if model in _available_models:
        return _available_models[model]
    init_vertex()
    from vertexai.generative_models import GenerativeModel

    candidates = [model] + MODEL_FALLBACK_CHAIN.get(model, [])
    last_err: Exception | None = None
    for cand in candidates:
        try:
            GenerativeModel(cand).generate_content(
                "ok", generation_config={"max_output_tokens": 1}
            )
            if cand != model:
                log.warning("model_fallback", requested=model, using=cand)
            _available_models[model] = cand
            return cand
        except Exception as e:  # availability probe only
            last_err = e
            continue
    raise RuntimeError(f"No available model for {model} (tried {candidates}): {last_err}")


def prep_image(img: Image.Image, line_art: bool = True) -> bytes:
    """Downscale to ≤ {MAX_IMG_DIM}px max dim; PNG for line art, JPEG q88 otherwise."""
    w, h = img.size
    scale = min(1.0, MAX_IMG_DIM / max(w, h))
    if scale < 1.0:
        img = img.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
    buf = io.BytesIO()
    if line_art:
        img.convert("RGB").save(buf, format="PNG", optimize=True)
    else:
        img.convert("RGB").save(buf, format="JPEG", quality=88)
    return buf.getvalue()


def _cache_key(prompt: str, model: str, image_bytes: list[bytes]) -> str:
    h = hashlib.sha256()
    h.update(prompt.encode("utf-8"))
    h.update(model.encode())
    for b in sorted(hashlib.sha256(i).hexdigest() for i in image_bytes):
        h.update(b.encode())
    return h.hexdigest()


def strip_fences(text: str) -> str:
    t = text.strip()
    t = re.sub(r"^```(?:json)?\s*", "", t)
    t = re.sub(r"\s*```$", "", t)
    return t.strip()


def parse_json_response(text: str):
    t = strip_fences(text)
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        # last-ditch: grab the outermost {...} or [...]
        m = re.search(r"(\{.*\}|\[.*\])", t, flags=re.DOTALL)
        if m:
            return json.loads(m.group(1))
        raise


RETRYABLE = ("429", "503", "504", "RESOURCE_EXHAUSTED", "UNAVAILABLE", "DEADLINE")


class QuotaPause(Exception):
    """Raised when retries are exhausted on quota errors — the job runner
    pauses (not fails) so the run can resume near-free from cache (edge #17)."""


async def generate(
    prompt: str,
    *,
    model: str,
    purpose: str,
    images: list[Image.Image] | None = None,
    json_response: bool = True,
    timeout_s: int | None = None,
    job_id: str | None = None,
    line_art: bool = True,
    use_cache: bool = True,
):
    """Single entry point for every Gemini call in the pipeline."""
    image_bytes = [prep_image(im, line_art=line_art) for im in (images or [])]
    resolved = resolve_model(model)
    key = _cache_key(prompt, resolved, image_bytes)

    if use_cache:
        with session() as s:
            hit = s.get(LlmCache, key)
            if hit:
                _log_call(job_id, resolved, purpose, 0, 0, 0, 0, cache_hit=True)
                return parse_json_response(hit.response) if json_response else hit.response

    init_vertex()
    from vertexai.generative_models import GenerationConfig, GenerativeModel, Part

    thinking = purpose in THINKING_PURPOSES
    timeout = timeout_s or (300 if thinking else 90)
    gen_cfg: dict = {"max_output_tokens": 65535 if thinking else 8192}
    if json_response:
        gen_cfg["response_mime_type"] = "application/json"

    parts: list = []
    for i, b in enumerate(image_bytes, 1):
        parts.append(Part.from_data(data=b, mime_type="image/png" if line_art else "image/jpeg"))
    parts.append(prompt)

    gm = GenerativeModel(resolved)
    delay = 1.0
    last_err: Exception | None = None
    for attempt in range(5):
        async with _sem():
            t0 = time.monotonic()
            try:
                resp = await asyncio.wait_for(
                    asyncio.to_thread(
                        gm.generate_content, parts, generation_config=GenerationConfig(**gen_cfg)
                    ),
                    timeout=timeout,
                )
                latency = int((time.monotonic() - t0) * 1000)
                text = resp.text
                usage = getattr(resp, "usage_metadata", None)
                _log_call(
                    job_id, resolved, purpose,
                    getattr(usage, "prompt_token_count", 0) or 0,
                    getattr(usage, "candidates_token_count", 0) or 0,
                    getattr(usage, "thoughts_token_count", 0) or 0,
                    latency, cache_hit=False,
                )
                with session() as s:
                    s.merge(LlmCache(key=key, response=text, model=resolved))
                if not json_response:
                    return text
                try:
                    return parse_json_response(text)
                except Exception:
                    # one repair retry on malformed JSON (edge #16)
                    repair = await asyncio.to_thread(
                        gm.generate_content,
                        [f"Fix this into valid JSON only, no fences, no preamble:\n{text}"],
                        generation_config=GenerationConfig(
                            response_mime_type="application/json", max_output_tokens=gen_cfg["max_output_tokens"]
                        ),
                    )
                    return parse_json_response(repair.text)
            except Exception as e:
                msg = str(e)
                if "400" in msg or "INVALID_ARGUMENT" in msg:
                    raise  # prompt bug — fail loudly, never retry
                last_err = e
                if not any(code in msg for code in RETRYABLE) and not isinstance(e, asyncio.TimeoutError):
                    raise
        jitter = delay * 0.25 * (2 * random.random() - 1)
        await asyncio.sleep(delay + jitter)
        delay = min(delay * 2, 16)
    raise QuotaPause(f"Vertex retries exhausted for {purpose}: {last_err}")


def _log_call(job_id, model, purpose, in_tok, out_tok, think_tok, latency_ms, cache_hit):
    with session() as s:
        s.add(LlmCall(
            id=uuid.uuid4().hex, job_id=job_id, model=model, purpose=purpose,
            in_tokens=in_tok, out_tokens=out_tok, thinking_tokens=think_tok,
            latency_ms=latency_ms, cache_hit=1 if cache_hit else 0,
        ))


# --- prompts ---------------------------------------------------------------

PROMPTS_DIR = Path(__file__).resolve().parent.parent / "prompts"


def load_prompt(name: str, **kwargs: object) -> str:
    """Load prompts/<name>.txt and .format(**kwargs) with brace-safety."""
    tpl = (PROMPTS_DIR / f"{name}.txt").read_text(encoding="utf-8")
    out = tpl
    for k, v in kwargs.items():
        out = out.replace("{" + k + "}", str(v))
    return out


def auth_check() -> tuple[bool, str]:
    """Startup check: one 1-token call; fail fast with a clear message (§11.1)."""
    from ..config import LATEST_FLASH

    try:
        init_vertex()
        resolved = resolve_model(LATEST_FLASH)
        return True, f"Vertex auth OK (using {resolved})"
    except Exception as e:
        return False, f"Vertex auth FAILED: {e}"
