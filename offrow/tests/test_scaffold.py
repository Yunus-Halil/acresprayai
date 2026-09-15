"""The scaffold holds: every module imports, and every stub says so honestly.

A stub that silently returns None instead of raising is worse than no stub,
because it lets a caller build on an answer that was never computed.
"""

from __future__ import annotations

import importlib
import inspect

import pytest

MODULES = [
    "offrow.blobs",
    "offrow.candidates",
    "offrow.cli",
    "offrow.datasets",
    "offrow.eval",
    "offrow.grid",
    "offrow.io",
    "offrow.rows",
    "offrow.sensor",
    "offrow.synth",
    "offrow.vegetation",
]

#: Implemented modules are exempt from the stub checks below. Removing a name
#: from here is part of shipping the step that implements it.
IMPLEMENTED = (
    "offrow.sensor",
    "offrow.cli",
    "offrow.datasets",
    "offrow.synth",
    "offrow.io",
    "offrow.vegetation",
    "offrow.rows",
)

STUB_MODULES = [m for m in MODULES if m not in IMPLEMENTED]


@pytest.mark.parametrize("name", MODULES)
def test_module_imports(name):
    importlib.import_module(name)


@pytest.mark.parametrize("name", STUB_MODULES)
def test_stubs_raise_rather_than_return_none(name):
    module = importlib.import_module(name)
    functions = [
        obj
        for obj_name, obj in vars(module).items()
        if inspect.isfunction(obj) and obj.__module__ == name and not obj_name.startswith("_")
    ]
    assert functions, f"{name} declares no public functions"
    for func in functions:
        source = inspect.getsource(func)
        assert "raise NotImplementedError" in source, (
            f"{name}.{func.__name__} is not an honest stub"
        )


@pytest.mark.parametrize("name", STUB_MODULES)
def test_stubs_are_documented(name):
    module = importlib.import_module(name)
    assert module.__doc__, f"{name} has no module docstring"
    for obj_name, obj in vars(module).items():
        if inspect.isfunction(obj) and obj.__module__ == name and not obj_name.startswith("_"):
            assert obj.__doc__, f"{name}.{obj_name} has no docstring"


def test_no_machine_learning_dependency():
    """The current phase is geometric. A model import here is a spec violation."""
    import pathlib

    banned = (
        "import torch",
        "import tensorflow",
        "from torch",
        "from tensorflow",
        "import sklearn",
    )
    root = pathlib.Path(__file__).resolve().parents[1] / "src" / "offrow"
    for path in root.rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        for token in banned:
            assert token not in text, f"{path.name} imports a machine learning framework"
