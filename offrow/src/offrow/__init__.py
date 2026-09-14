"""offrow: off-row vegetation detection in early-season corn from RGB drone imagery.

The one idea: do not learn what corn looks like, learn where corn is. Corn is
planted in rows at a spacing the grower already knows, so vegetation between the
rows is by construction not the planted crop. That is geometry, not prediction.

The output is a ranked review queue. A human confirms. Nothing here decides that
anything is a weed.

The altitude ladder comes from real flights, not from simulation. There is no
``altitude.py``.
"""

from __future__ import annotations

__version__ = "0.1.0"

__all__ = [
    "__version__",
    "blobs",
    "candidates",
    "datasets",
    "eval",
    "grid",
    "io",
    "rows",
    "sensor",
    "synth",
    "vegetation",
]
