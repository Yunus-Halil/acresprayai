"""Make `weedlab` importable from the scripts directory without an install.

Every script does `import _bootstrap` first. If the package is already installed
(pip install -e), this is a no-op.
"""

import sys
from pathlib import Path

_SRC = Path(__file__).resolve().parents[1] / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))
