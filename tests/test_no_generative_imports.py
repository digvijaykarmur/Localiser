"""NN-2: forbid generative image model imports in clean/typeset."""

from __future__ import annotations

import ast
from pathlib import Path

DENY = {
    "diffusers",
    "stability_sdk",
    "openai",
    "replicate",
    "imagen",
    "vertexai.preview.vision_models",
    "google.cloud.aiplatform.gapic.PredictionServiceClient",
    "lama_cleaner",
    "simple_lama_inpainting",
    "torchvision.models.segmentation",  # not used for gen but keep narrow
}


def _imports_in(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    found: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                found.add(a.name)
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                found.add(node.module)
    return found


def test_no_generative_imports():
    root = Path(__file__).resolve().parents[1] / "localiser" / "pipeline"
    targets = [root / "clean.py", root / "typeset.py"]
    for t in targets:
        assert t.exists(), t
        imports = _imports_in(t)
        for d in DENY:
            for imp in imports:
                assert not (imp == d or imp.startswith(d + ".")), f"{t.name} imports {imp}"
