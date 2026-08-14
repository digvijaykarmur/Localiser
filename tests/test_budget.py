"""NN-1 — the pixel budget assertion (§7.6)."""
import numpy as np
import pytest
from PIL import Image

from localiser.pipeline.budget import BudgetViolation, verify_change_budget


def _setup(tmp_path, change_inside=True, change_outside=False, resize=False):
    (tmp_path / "masks").mkdir()
    orig = np.random.default_rng(1).integers(0, 255, (60, 80, 4), np.uint8)
    orig[..., 3] = 255
    Image.fromarray(orig).save(tmp_path / "original.png")

    budget = np.zeros((60, 80), np.uint8)
    budget[10:30, 10:40] = 255
    Image.fromarray(budget).save(tmp_path / "masks" / "budget.png")

    comp = orig.copy()
    if change_inside:
        comp[12:28, 12:38] = [255, 255, 255, 255]
    if change_outside:
        comp[50, 70] = [0, 0, 0, 255]
    if resize:
        comp = comp[:59]
    Image.fromarray(comp).save(tmp_path / "composite.png")


def test_changes_inside_budget_pass(tmp_path):
    _setup(tmp_path, change_inside=True)
    verify_change_budget(tmp_path)  # must not raise


def test_single_pixel_outside_budget_fails(tmp_path):
    _setup(tmp_path, change_outside=True)
    with pytest.raises(BudgetViolation) as e:
        verify_change_budget(tmp_path)
    assert "outside the approved mask" in str(e.value)
    assert e.value.coords  # exact coordinates surfaced for the red overlay


def test_dimension_change_always_fails(tmp_path):
    _setup(tmp_path, resize=True)
    with pytest.raises(BudgetViolation, match="dimensions changed"):
        verify_change_budget(tmp_path)


def test_untouched_composite_passes(tmp_path):
    _setup(tmp_path, change_inside=False)
    verify_change_budget(tmp_path)
