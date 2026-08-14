import numpy as np
import pytest
from PIL import Image

from localiser.layers import BudgetViolation, rebuild_composite, verify_change_budget


def _page(tmp_path):
    page = tmp_path / "page"
    (page / "masks").mkdir(parents=True)
    Image.new("RGBA", (20, 20), "white").save(page / "original.png")
    budget = np.zeros((20, 20), dtype=np.uint8)
    budget[5:15, 5:15] = 255
    Image.fromarray(budget).save(page / "masks" / "budget.png")
    return page


def test_rebuild_changes_only_budget(tmp_path):
    page = _page(tmp_path)
    layer = Image.new("RGBA", (20, 20))
    pixels = np.asarray(layer).copy()
    pixels[8:12, 8:12] = [0, 0, 0, 255]
    Image.fromarray(pixels).save(page / "text_layer.png")
    rebuild_composite(page)
    verify_change_budget(page)


def test_rejects_layer_alpha_outside_budget(tmp_path):
    page = _page(tmp_path)
    layer = Image.new("RGBA", (20, 20))
    pixels = np.asarray(layer).copy()
    pixels[0, 0] = [0, 0, 0, 255]
    Image.fromarray(pixels).save(page / "clean_layer.png")
    with pytest.raises(BudgetViolation, match="outside budget"):
        rebuild_composite(page)
