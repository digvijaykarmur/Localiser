import ast
from pathlib import Path


DENYLIST = {"diffusers", "stability_sdk", "openai.images", "vertexai.preview.vision_models"}


def test_cleaning_and_typesetting_never_import_image_generators():
    root = Path(__file__).parents[1] / "src" / "localiser"
    for filename in ("layers.py",):
        tree = ast.parse((root / filename).read_text(encoding="utf-8"))
        imports = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imports.extend(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom):
                imports.append(node.module or "")
        assert not any(
            imported == denied or imported.startswith(f"{denied}.")
            for imported in imports
            for denied in DENYLIST
        )
