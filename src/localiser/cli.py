import argparse
import importlib.util
import sqlite3
import sys

from PIL import features

from .config import get_settings
from .db import init_db
from .vertex import credentials_check


def doctor() -> int:
    settings = get_settings()
    checks: list[tuple[str, bool, str]] = []

    checks.append(("Python", sys.version_info >= (3, 11), sys.version.split()[0]))
    checks.append(
        ("Workspace", settings.workspace.is_dir(), str(settings.workspace.resolve()))
    )
    try:
        init_db()
        with sqlite3.connect(settings.workspace / "localiser.db") as db:
            db.execute("SELECT 1")
        checks.append(("SQLite", True, "schema ready"))
    except Exception as exc:
        checks.append(("SQLite", False, str(exc)))

    checks.append(
        (
            "Pillow libraqm",
            bool(features.check("raqm")),
            "Indic shaping available" if features.check("raqm") else "Chromium fallback required",
        )
    )
    checks.append(
        (
            "Playwright",
            importlib.util.find_spec("playwright") is not None,
            "installed" if importlib.util.find_spec("playwright") else "not installed",
        )
    )
    auth_ok, auth_detail = credentials_check(settings)
    checks.append(("Vertex credentials", auth_ok, auth_detail))
    checks.append(
        (
            "GCP project",
            bool(settings.gcp_project),
            settings.gcp_project or "GCP_PROJECT is not set",
        )
    )

    print("Localiser doctor")
    for name, passed, detail in checks:
        print(f"[{'PASS' if passed else 'FAIL'}] {name}: {detail}")
    failed_required = [
        name
        for name, passed, _ in checks
        if not passed and name not in {"Pillow libraqm", "Playwright", "Vertex credentials", "GCP project"}
    ]
    if not auth_ok:
        print("\nVertex is optional for ingest, but required for AI pipeline stages.")
    return int(bool(failed_required))


def main() -> None:
    parser = argparse.ArgumentParser(prog="localiser")
    parser.add_argument("command", choices=["doctor", "serve"])
    args = parser.parse_args()
    if args.command == "doctor":
        raise SystemExit(doctor())
    import uvicorn

    uvicorn.run("localiser.api:app", host="127.0.0.1", port=8420, reload=True)


if __name__ == "__main__":
    main()
