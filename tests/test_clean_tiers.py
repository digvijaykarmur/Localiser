"""§7.4 fill tiers + §7.2 layer model behavior on synthetic bubbles."""
import numpy as np
from PIL import Image

from localiser.pipeline.clean import choose_tier_and_fill


def _flat_bubble():
    """White bubble with black 'text' pixels."""
    orig = np.full((100, 100, 4), 250, np.uint8)
    orig[..., 3] = 255
    mask = np.zeros((100, 100), np.uint8)
    mask[40:60, 30:70] = 255                 # glyph mask
    interior = np.zeros((100, 100), np.uint8)
    interior[20:80, 15:85] = 255
    orig[40:60, 30:70, :3] = 10              # the text ink
    return orig, mask, interior


def test_tier1_flat_fill_is_pixel_exact():
    orig, mask, interior = _flat_bubble()
    tier, fill = choose_tier_and_fill(orig, mask, interior, 100 * 100, risk=0.1,
                                      risk_abort=0.85, max_tier=3)
    assert tier == 1
    sel = mask > 0
    assert (fill[sel][:, 3] == 255).all()
    # fill color equals the surrounding median (250)
    assert (np.abs(fill[sel][:, :3].astype(int) - 250) <= 1).all()
    # alpha zero everywhere outside the mask — layer cannot leak
    assert (fill[~sel][:, 3] == 0).all()


def test_tier2_gradient_fill():
    orig = np.zeros((100, 100, 4), np.uint8)
    orig[..., 3] = 255
    ramp = np.linspace(180, 220, 100).astype(np.uint8)
    for ch in range(3):
        orig[..., ch] = ramp[None, :]
    mask = np.zeros((100, 100), np.uint8)
    mask[45:55, 40:60] = 255
    interior = np.zeros((100, 100), np.uint8)
    interior[20:80, 15:85] = 255
    orig[45:55, 40:60, :3] = 0
    tier, fill = choose_tier_and_fill(orig, mask, interior, 100 * 100, risk=0.1,
                                      risk_abort=0.85, max_tier=3)
    assert tier == 2
    sel = mask > 0
    # fill follows the ramp: left side darker than right side
    left = fill[45:55, 40:45, 0].mean()
    right = fill[45:55, 55:60, 0].mean()
    assert right > left


def test_tier4_defer_on_high_risk():
    orig, mask, interior = _flat_bubble()
    tier, fill = choose_tier_and_fill(orig, mask, interior, 100 * 100, risk=0.95,
                                      risk_abort=0.85, max_tier=3)
    assert tier == 4 and fill is None      # never cleans risky regions
