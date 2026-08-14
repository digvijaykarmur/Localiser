import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


@pytest.fixture()
def tmp_workspace(tmp_path, monkeypatch):
    """Point CFG at a throwaway workspace + fresh DB for each test."""
    from localiser import config as config_mod
    from localiser import db as db_mod

    monkeypatch.setattr(config_mod.CFG, "workspace", tmp_path)
    config_mod.CFG.ensure_dirs()
    db_mod._engine = None
    db_mod._SessionLocal = None
    db_mod.init_db(tmp_path / "test.db")
    yield tmp_path
    db_mod._engine = None
    db_mod._SessionLocal = None
