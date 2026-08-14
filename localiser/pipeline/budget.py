"""The Pixel Budget Assertion — NN-1 proof (§7.6).

Runs after every composite build and again at export. Non-negotiable.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image


class BudgetViolation(Exception):
    def __init__(self, message: str, coords: list[tuple[int, int]] | None = None):
        super().__init__(message)
        self.coords = coords or []


def verify_change_budget(page_dir: Path) -> None:
    orig = np.array(Image.open(page_dir / "original.png").convert("RGBA"))
    comp = np.array(Image.open(page_dir / "composite.png").convert("RGBA"))
    budget_path = page_dir / "masks" / "budget.png"
    if budget_path.exists():
        budget = np.array(Image.open(budget_path).convert("L")) > 0
    else:
        budget = np.zeros(orig.shape[:2], bool)

    if orig.shape[:2] != comp.shape[:2]:
        raise BudgetViolation("dimensions changed")  # never allowed

    outside = ~budget
    if not np.array_equal(orig[outside], comp[outside]):
        diff = np.argwhere(np.any(orig != comp, axis=2) & outside)
        coords = [(int(y), int(x)) for y, x in diff[:50]]
        raise BudgetViolation(
            f"{len(diff)} pixels changed outside the approved mask; "
            f"first at (y={diff[0][0]}, x={diff[0][1]})",
            coords=coords,
        )


def diff_overlay(page_dir: Path) -> Image.Image:
    """Red overlay of changed pixels — shown on the canvas after a violation
    and available as the 'diff' view."""
    orig = np.array(Image.open(page_dir / "original.png").convert("RGBA"))
    comp = np.array(Image.open(page_dir / "composite.png").convert("RGBA"))
    out = orig.copy()
    changed = np.any(orig != comp, axis=2)
    out[changed] = [200, 55, 42, 255]  # vermilion
    return Image.fromarray(out)
