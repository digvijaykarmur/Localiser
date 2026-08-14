"""NN-2 enforcement — a real test, not a comment (§7.1).

Walks the ASTs of pipeline/clean.py and pipeline/typeset.py and fails on any
import matching a denylist of generative-image clients.
"""
import ast
from pathlib import Path

PIPELINE = Path(__file__).resolve().parent.parent / "localiser" / "pipeline"

DENYLIST = (
    "diffusers", "stable_diffusion", "torch", "diffusion",
    "imagen", "dalle", "openai", "replicate", "comfy",
    "lama_cleaner", "iopaint", "flux", "sdxl",
    "generative_models",  # no Vertex image-generation in these modules either
)

CHECKED_MODULES = ["clean.py", "typeset.py", "budget.py"]


def _imports_of(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    names = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names += [a.name for a in node.names]
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                names.append(node.module)
            names += [a.name for a in node.names]
    return names


def test_no_generative_imports_in_clean_and_typeset():
    violations = []
    for mod in CHECKED_MODULES:
        path = PIPELINE / mod
        assert path.exists(), f"{mod} missing"
        for name in _imports_of(path):
            low = name.lower()
            for banned in DENYLIST:
                if banned in low:
                    violations.append(f"{mod}: import '{name}' matches banned '{banned}'")
    assert not violations, "\n".join(violations)


def test_entire_pipeline_tree_free_of_diffusion_clients():
    hard_banned = ("diffusers", "stable_diffusion", "imagen", "dalle", "iopaint", "lama_cleaner")
    violations = []
    for path in PIPELINE.glob("*.py"):
        for name in _imports_of(path):
            low = name.lower()
            for banned in hard_banned:
                if banned in low:
                    violations.append(f"{path.name}: {name}")
    assert not violations, "\n".join(violations)
