"""Stage 1 — CV bubble detector (deterministic edges)."""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np


@dataclass
class BubbleCandidate:
    polygon: list[list[int]]
    bbox: tuple[int, int, int, int]  # x, y, w, h
    glyph_mask: np.ndarray
    interior_color: tuple[int, int, int]
    area: float


def _bbox_from_contour(c: np.ndarray) -> tuple[int, int, int, int]:
    x, y, w, h = cv2.boundingRect(c)
    return int(x), int(y), int(w), int(h)


def detect_bubbles_cv(bgr: np.ndarray) -> list[BubbleCandidate]:
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    page_area = gray.shape[0] * gray.shape[1]
    _, bright = cv2.threshold(gray, 235, 255, cv2.THRESH_BINARY)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    bright = cv2.morphologyEx(bright, cv2.MORPH_CLOSE, kernel)
    contours, _ = cv2.findContours(bright, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    out: list[BubbleCandidate] = []
    for c in contours:
        area = float(cv2.contourArea(c))
        if area < 0.0004 * page_area or area > 0.35 * page_area:
            continue
        hull = cv2.convexHull(c)
        hull_area = float(cv2.contourArea(hull)) or 1.0
        solidity = area / hull_area
        if solidity < 0.55:
            continue
        x, y, w, h = _bbox_from_contour(c)
        roi = gray[y : y + h, x : x + w]
        if roi.size == 0:
            continue
        ink = float(np.count_nonzero(roi < 110)) / float(roi.size)
        if not (0.02 < ink < 0.55):
            continue

        approx = cv2.approxPolyDP(c, 0.01 * cv2.arcLength(c, True), True)
        polygon = [[int(p[0][0]), int(p[0][1])] for p in approx]

        # Glyph mask inside candidate
        glyph = cv2.adaptiveThreshold(
            roi, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 25, 9
        )
        glyph = _remove_small_components(glyph, min_area=6)
        glyph = cv2.dilate(glyph, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)), iterations=2)

        full_mask = np.zeros(gray.shape, dtype=np.uint8)
        full_mask[y : y + h, x : x + w] = glyph

        bright_pixels = roi[roi > 235]
        if bright_pixels.size:
            # Approximate interior as gray median → RGB
            med = int(np.median(bright_pixels))
            interior = (med, med, med)
        else:
            interior = (252, 252, 250)

        out.append(
            BubbleCandidate(
                polygon=polygon,
                bbox=(x, y, w, h),
                glyph_mask=full_mask,
                interior_color=interior,
                area=area,
            )
        )
    return out


def _remove_small_components(mask: np.ndarray, min_area: int) -> np.ndarray:
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    out = np.zeros_like(mask)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] >= min_area:
            out[labels == i] = 255
    return out


def glyph_mask_from_bbox(gray: np.ndarray, bbox: tuple[int, int, int, int]) -> np.ndarray:
    x, y, w, h = bbox
    roi = gray[y : y + h, x : x + w]
    if roi.size == 0:
        return np.zeros(gray.shape, dtype=np.uint8)
    glyph = cv2.adaptiveThreshold(
        roi, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 25, 9
    )
    glyph = _remove_small_components(glyph, min_area=6)
    glyph = cv2.dilate(glyph, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)), iterations=2)
    full = np.zeros(gray.shape, dtype=np.uint8)
    full[y : y + h, x : x + w] = glyph
    return full


def iou_box(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    ax2, ay2 = ax + aw, ay + ah
    bx2, by2 = bx + bw, by + bh
    ix1, iy1 = max(ax, bx), max(ay, by)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0, ix2 - ix1), max(0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    union = aw * ah + bw * bh - inter
    return inter / union if union else 0.0
