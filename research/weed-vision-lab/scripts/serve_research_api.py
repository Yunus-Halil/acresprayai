"""Start the local Weed Vision research inference service on 127.0.0.1:8765.

    D:\\swardus-research\\weed-vision-lab-venv\\Scripts\\python scripts\\serve_research_api.py

Stop it with Ctrl+C. Research preview only; see docs/research-preview.md.
"""

import _bootstrap  # noqa: F401

from weedlab.service.app import main

if __name__ == "__main__":
    raise SystemExit(main())
