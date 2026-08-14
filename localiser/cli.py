"""CLI — `python -m localiser.cli doctor` and friends (§16).

`doctor` checks, and prints pass/fail for each:
Vertex auth, model availability in the configured region, Pillow raqm support,
Playwright Chromium present, all fonts present with Devanagari coverage,
shaping golden-image match, workspace writable, SQLite migrations current.
Fails loudly and specifically.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

from .config import CFG, DEFAULT_MODELS

GREEN = "\033[92m✔\033[0m"
RED = "\033[91m✘\033[0m"
YELLOW = "\033[93m⚠\033[0m"

DEVA_TEST = "क्षत्रिय हिंदी में लिखा है — प्रिय, कृष्ण, द्वारा"

# common conjuncts + matras that must be present in a usable Devanagari font
DEVA_REQUIRED_CODEPOINTS = [0x0915, 0x094D, 0x0937, 0x0924, 0x094D, 0x0930,
                            0x093F, 0x0940, 0x0943, 0x0902, 0x0901]


def _check(label: str, ok: bool, detail: str = "") -> bool:
    mark = GREEN if ok else RED
    print(f"  {mark} {label}" + (f" — {detail}" if detail else ""))
    return ok


def doctor() -> int:
    print("Localiser doctor\n================")
    all_ok = True

    # workspace writable
    try:
        CFG.ensure_dirs()
        probe = CFG.workspace / ".write_probe"
        probe.write_text("ok")
        probe.unlink()
        all_ok &= _check("workspace writable", True, str(CFG.workspace))
    except Exception as e:
        all_ok &= _check("workspace writable", False, str(e))

    # sqlite migrations current
    try:
        from .db import init_db

        init_db()
        all_ok &= _check("SQLite schema current", True, str(CFG.db_path))
    except Exception as e:
        all_ok &= _check("SQLite schema current", False, str(e))

    # Pillow raqm
    try:
        from PIL import features

        raqm = bool(features.check("raqm"))
        if raqm:
            _check("Pillow libraqm shaping (Engine B)", True)
        else:
            print(f"  {YELLOW} Pillow libraqm NOT available — Engine A (Chromium) will be forced")
    except Exception as e:
        all_ok &= _check("Pillow libraqm shaping", False, str(e))

    # Playwright Chromium
    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as pw:
            b = pw.chromium.launch()
            b.close()
        all_ok &= _check("Playwright Chromium (Engine A)", True)
    except Exception as e:
        all_ok &= _check("Playwright Chromium (Engine A)", False,
                         f"{e} — run: playwright install chromium")

    # fonts with Devanagari coverage
    fonts_dir = CFG.assets_dir / "fonts"
    fonts = list(fonts_dir.glob("*.[ot]tf")) if fonts_dir.exists() else []
    if not fonts:
        all_ok &= _check("fonts present", False,
                         f"no .ttf/.otf in {fonts_dir} — download Mukta/Kalam/Yatra One from Google Fonts")
    else:
        for f in fonts:
            try:
                from fontTools.ttLib import TTFont  # type: ignore

                tt = TTFont(str(f))
                cmap = tt.getBestCmap()
                missing = [hex(cp) for cp in DEVA_REQUIRED_CODEPOINTS if cp not in cmap]
                _check(f"font {f.name} Devanagari coverage", not missing,
                       f"missing {missing}" if missing else "")
                if missing:
                    all_ok = False
            except ImportError:
                # fontTools not installed: basic render probe via PIL
                try:
                    from PIL import ImageFont

                    font = ImageFont.truetype(str(f), 24)
                    ok = font.getlength(DEVA_TEST) > 0
                    _check(f"font {f.name} loads + measures Devanagari", ok)
                    all_ok &= ok
                except Exception as e:
                    all_ok &= _check(f"font {f.name}", False, str(e))
            except Exception as e:
                all_ok &= _check(f"font {f.name}", False, str(e))

    # shaping golden self-test (§8.3)
    golden = CFG.assets_dir / "qa" / "deva_golden.png"
    if golden.exists():
        try:
            ok = asyncio.run(_shaping_selftest(golden))
            all_ok &= _check("Devanagari shaping golden match", ok)
        except Exception as e:
            all_ok &= _check("Devanagari shaping golden match", False, str(e))
    else:
        print(f"  {YELLOW} no golden image at {golden} — run `python -m localiser.cli golden` "
              "once on a machine with verified rendering to create it")

    # Vertex auth + model availability
    if not CFG.gcp_project:
        all_ok &= _check("Vertex auth", False, "GCP_PROJECT not set in .env")
    else:
        from .ai.vertex import auth_check, resolve_model

        ok, msg = auth_check()
        all_ok &= _check("Vertex auth (1-token probe)", ok, msg)
        if ok:
            for purpose, model in DEFAULT_MODELS.items():
                try:
                    resolved = resolve_model(model)
                    _check(f"model {purpose}", True,
                           f"{model}" + (f" → {resolved}" if resolved != model else ""))
                except Exception as e:
                    all_ok &= _check(f"model {purpose} ({model})", False, str(e))

    print("\n" + ("All checks passed." if all_ok else "SOME CHECKS FAILED — fix before running the pipeline."))
    return 0 if all_ok else 1


async def _shaping_selftest(golden: Path) -> bool:
    from PIL import Image
    from .pipeline.bible import _dhash  # perceptual hash reuse
    from .pipeline.typeset import get_renderer

    r = get_renderer()
    await r.start()
    try:
        img = await r.render(DEVA_TEST, "Mukta-Regular", 28, 900, 120, 1.3, 0.0, "#141210")
    finally:
        await r.stop()
    import numpy as np

    a = _dhash(img.convert("RGB"))
    b = _dhash(Image.open(golden).convert("RGB"))
    hamming = int(np.count_nonzero(np.array(a, bool) != np.array(b, bool)))
    return hamming < len(a) * 0.15


def make_golden() -> int:
    async def _run():
        from .pipeline.typeset import get_renderer

        r = get_renderer()
        await r.start()
        try:
            img = await r.render(DEVA_TEST, "Mukta-Regular", 28, 900, 120, 1.3, 0.0, "#141210")
        finally:
            await r.stop()
        out = CFG.assets_dir / "qa" / "deva_golden.png"
        out.parent.mkdir(parents=True, exist_ok=True)
        img.save(out)
        print(f"golden written: {out} — verify the conjuncts visually before trusting it")

    asyncio.run(_run())
    return 0


def main() -> int:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "doctor"
    if cmd == "doctor":
        return doctor()
    if cmd == "golden":
        return make_golden()
    print(f"unknown command: {cmd}\nusage: python -m localiser.cli [doctor|golden]")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
