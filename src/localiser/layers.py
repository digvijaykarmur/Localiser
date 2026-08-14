from pathlib import Path
import shutil
import tempfile

import numpy as np
from PIL import Image


class BudgetViolation(RuntimeError):
    pass


def _rgba(path: Path) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGBA"))


def verify_change_budget(page_dir: Path) -> None:
    original = _rgba(page_dir / "original.png")
    composite = _rgba(page_dir / "composite.png")
    budget = np.asarray(Image.open(page_dir / "masks" / "budget.png").convert("L")) > 0
    if original.shape[:2] != composite.shape[:2] or budget.shape != original.shape[:2]:
        raise BudgetViolation("dimensions changed")
    outside = ~budget
    changed = np.any(original != composite, axis=2) & outside
    if np.any(changed):
        first_y, first_x = np.argwhere(changed)[0]
        raise BudgetViolation(
            f"{int(changed.sum())} pixels changed outside the approved mask; "
            f"first at (y={first_y}, x={first_x})"
        )


def _validate_layer(layer: Image.Image, budget: np.ndarray, name: str) -> None:
    alpha = np.asarray(layer.convert("RGBA"))[:, :, 3] > 0
    leaked = alpha & ~budget
    if np.any(leaked):
        y, x = np.argwhere(leaked)[0]
        raise BudgetViolation(f"{name} has alpha outside budget at (y={y}, x={x})")


def rebuild_composite(page_dir: Path, keep_history: int = 20) -> Path:
    original = Image.open(page_dir / "original.png").convert("RGBA")
    budget_path = page_dir / "masks" / "budget.png"
    budget = np.asarray(Image.open(budget_path).convert("L")) > 0
    if budget.shape != (original.height, original.width):
        raise BudgetViolation("budget dimensions do not match original")

    layers: list[Image.Image] = []
    for name in ("clean_layer.png", "text_layer.png"):
        path = page_dir / name
        layer = Image.open(path).convert("RGBA") if path.exists() else Image.new("RGBA", original.size)
        if layer.size != original.size:
            raise BudgetViolation(f"{name} dimensions do not match original")
        _validate_layer(layer, budget, name)
        layers.append(layer)

    history = page_dir / "history"
    history.mkdir(exist_ok=True)
    existing = page_dir / "composite.png"
    if existing.exists():
        versions = sorted(history.glob("v*_composite.png"))
        next_version = int(versions[-1].stem.split("_")[0][1:]) + 1 if versions else 1
        shutil.copy2(existing, history / f"v{next_version:03d}_composite.png")

    composite = original.copy()
    for layer in layers:
        composite.alpha_composite(layer)
    with tempfile.NamedTemporaryFile(dir=page_dir, suffix=".png", delete=False) as tmp:
        temp_path = Path(tmp.name)
    try:
        composite.save(temp_path, "PNG")
        temp_path.replace(existing)
        verify_change_budget(page_dir)
    except Exception:
        temp_path.unlink(missing_ok=True)
        existing.unlink(missing_ok=True)
        raise

    versions = sorted(history.glob("v*_composite.png"))
    for old in versions[:-keep_history]:
        old.unlink()
    return existing
