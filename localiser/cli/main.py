"""CLI — localiser doctor / serve / version."""

from __future__ import annotations

import sys
from pathlib import Path

import typer
from rich.console import Console
from rich.table import Table

app = typer.Typer(name="localiser", help="Localiser — Hindi Manga Localization Studio", no_args_is_help=True)
console = Console()


@app.command()
def version():
    from localiser import PRODUCT_NAME, __version__

    console.print(f"{PRODUCT_NAME} v{__version__}")


@app.command()
def doctor():
    """Run all startup checks — fail loudly and specifically."""
    from localiser.config import LATEST_MODELS, get_settings
    from localiser.db import init_db
    from localiser.pipeline.typeset import font_path, shaping_self_test

    cfg = get_settings()
    rows: list[tuple[str, bool, str]] = []

    # Workspace
    try:
        root = cfg.workspace_root
        test = root / ".write_test"
        test.write_text("ok")
        test.unlink()
        rows.append(("workspace_writable", True, str(root)))
    except Exception as e:
        rows.append(("workspace_writable", False, str(e)))

    # SQLite
    try:
        init_db()
        rows.append(("sqlite_migrations", True, str(cfg.db_path)))
    except Exception as e:
        rows.append(("sqlite_migrations", False, str(e)))

    # Pillow raqm
    try:
        from PIL import features

        raqm = bool(features.check("raqm"))
        rows.append(("pillow_raqm", raqm, "ok" if raqm else "WARNING: force Chromium engine"))
    except Exception as e:
        rows.append(("pillow_raqm", False, str(e)))

    # Fonts
    required = ["Mukta-SemiBold", "Mukta-Regular", "Mukta-ExtraBold", "Kalam-Regular", "YatraOne-Regular"]
    missing = [r for r in required if not font_path(r)]
    rows.append(
        (
            "fonts_present",
            len(missing) == 0,
            "all present" if not missing else f"missing: {missing}",
        )
    )

    # Shaping self-test
    st = shaping_self_test()
    rows.append(("deva_shaping", bool(st.get("ok")), st.get("note") or f"ink={st.get('ink_pixels')}"))

    # Playwright chromium
    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            browser.close()
        rows.append(("playwright_chromium", True, "ok"))
    except Exception as e:
        rows.append(("playwright_chromium", False, str(e)))

    # Vertex auth — optional for offline ingest/clean/typeset; required for AI stages
    vertex_ok = True
    if not cfg.gcp_project or not cfg.google_application_credentials:
        vertex_ok = False
        rows.append(
            (
                "vertex_auth",
                False,
                "OPTIONAL until AI stages — set GOOGLE_APPLICATION_CREDENTIALS + GCP_PROJECT in .env",
            )
        )
    else:
        try:
            import asyncio
            from localiser.ai import vertex

            result = asyncio.run(vertex.smoke_test())
            rows.append(("vertex_auth", True, f"models={result.get('models')}"))
        except Exception as e:
            vertex_ok = False
            rows.append(("vertex_auth", False, str(e)))

    # Latest models pinned
    rows.append(
        (
            "latest_models_pinned",
            cfg.models == LATEST_MODELS,
            str(cfg.models),
        )
    )

    table = Table(title="Localiser doctor")
    table.add_column("Check")
    table.add_column("Pass")
    table.add_column("Detail")
    hard_failed = 0
    for name, ok, detail in rows:
        label = "[green]PASS[/]" if ok else (
            "[yellow]WARN[/]" if name == "vertex_auth" else "[red]FAIL[/]"
        )
        table.add_row(name, label, detail)
        if not ok and name != "vertex_auth":
            hard_failed += 1

    console.print(table)
    console.print(
        "\nModels (strictly latest): "
        + ", ".join(f"{k}={v}" for k, v in cfg.models.items())
    )
    if not vertex_ok:
        console.print(
            "\n[yellow]Vertex not configured — ingest / clean / typeset / UI still work. "
            "Add keys to .env before bible / translate / story.[/]"
        )
    if hard_failed:
        raise typer.Exit(code=1)


@app.command()
def serve(host: str = None, port: int = None, reload: bool = True):
    """Start FastAPI backend."""
    import uvicorn
    from localiser.config import get_settings

    cfg = get_settings()
    uvicorn.run(
        "localiser.api:app",
        host=host or cfg.api_host,
        port=port or cfg.api_port,
        reload=reload,
    )


@app.command("download-fonts")
def download_fonts():
    """Download SIL OFL Devanagari fonts into assets/fonts."""
    import urllib.request
    import zipfile
    import io

    from localiser.config import get_settings

    fonts_dir = get_settings().fonts_dir
    fonts_dir.mkdir(parents=True, exist_ok=True)
    # Google Fonts github mirrors
    urls = {
        "Mukta": "https://github.com/google/fonts/raw/main/ofl/mukta/Mukta%5Bwght%5D.ttf",
    }
    # Use fonts.google.com download via known raw paths
    files = [
        (
            "https://github.com/google/fonts/raw/main/ofl/mukta/Mukta-Regular.ttf",
            "Mukta-Regular.ttf",
        ),
        (
            "https://github.com/google/fonts/raw/main/ofl/mukta/Mukta-SemiBold.ttf",
            "Mukta-SemiBold.ttf",
        ),
        (
            "https://github.com/google/fonts/raw/main/ofl/mukta/Mukta-ExtraBold.ttf",
            "Mukta-ExtraBold.ttf",
        ),
        (
            "https://github.com/google/fonts/raw/main/ofl/kalam/Kalam-Regular.ttf",
            "Kalam-Regular.ttf",
        ),
        (
            "https://github.com/google/fonts/raw/main/ofl/yatraone/YatraOne-Regular.ttf",
            "YatraOne-Regular.ttf",
        ),
        (
            "https://github.com/google/fonts/raw/main/ofl/baloo2/Baloo2%5Bwght%5D.ttf",
            "Baloo2-Regular.ttf",
        ),
    ]
    for url, name in files:
        dest = fonts_dir / name
        if dest.exists():
            console.print(f"[dim]skip[/] {name}")
            continue
        try:
            console.print(f"Downloading {name}…")
            urllib.request.urlretrieve(url, dest)
        except Exception as e:
            console.print(f"[yellow]failed {name}: {e}[/]")
    console.print(f"Fonts in {fonts_dir}")


if __name__ == "__main__":
    app()
