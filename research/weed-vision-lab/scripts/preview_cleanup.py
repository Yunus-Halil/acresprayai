"""Remove the temporary Weed Vision Research Preview from the application working tree.

    python scripts/preview_cleanup.py --plan      # list what would change, change nothing
    python scripts/preview_cleanup.py --confirm   # restore modified app files from the research branch, delete new app files

Touches only the listed application files. Never touches .env, user data, the
database, the research lab, or anything else. Requires a clean index for the
listed files (commit or stash first) so that nothing unrelated is lost.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
BASE_BRANCH = "research/weed-vision-lab"
NEW_APP_FILES = [
    "src/lib/weedVision/flag.ts", "src/lib/weedVision/client.ts", "src/lib/weedVision/export.ts", "src/lib/weedVision/compare.ts",
    "src/components/app/weedVision/WeedOverlay.tsx", "src/pages/app/WeedVisionPreview.tsx", "src/test/weedVision.test.tsx",
]
MODIFIED_APP_FILES = [
    "src/App.tsx", "src/components/app/AppLayout.tsx", "src/components/app/workspace/PhotoViewer.tsx",
    "vite.config.ts", "src/vite-env.d.ts", ".env.example",
]


def git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=False).stdout.strip()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--plan", action="store_true")
    g.add_argument("--confirm", action="store_true")
    args = ap.parse_args(argv)
    branch = git("branch", "--show-current")
    print(f"repository {ROOT}\nbranch {branch}\n")
    print("New application files (would be deleted):")
    for f in NEW_APP_FILES:
        print(f"  {'present' if (ROOT / f).exists() else 'absent '}  {f}")
    print(f"\nModified application files (would be restored from {BASE_BRANCH}):")
    for f in MODIFIED_APP_FILES:
        changed = git("diff", "--quiet", BASE_BRANCH, "--", f) == "" and subprocess.run(["git", "diff", "--quiet", BASE_BRANCH, "--", f], cwd=ROOT).returncode != 0
        print(f"  {'differs' if changed else 'same   '}  {f}")
    if args.plan:
        print("\nNothing changed (--plan). Re-run with --confirm to apply.")
        return 0
    if git("rev-parse", "--verify", BASE_BRANCH) == "":
        print(f"\nbranch {BASE_BRANCH} not found; nothing done", file=sys.stderr)
        return 2
    answer = input("\nType REMOVE to restore the modified files and delete the new ones: ")
    if answer.strip() != "REMOVE":
        print("aborted; nothing changed")
        return 1
    for f in MODIFIED_APP_FILES:
        r = subprocess.run(["git", "checkout", BASE_BRANCH, "--", f], cwd=ROOT)
        print(f"  restored {f}" if r.returncode == 0 else f"  FAILED to restore {f}")
    for f in NEW_APP_FILES:
        p = ROOT / f
        if p.exists():
            p.unlink()
            print(f"  deleted {f}")
    for d in ("src/lib/weedVision", "src/components/app/weedVision"):
        p = ROOT / d
        if p.exists() and not any(p.iterdir()):
            p.rmdir()
            print(f"  removed empty {d}")
    print("\nDone. The .env flag, the research lab and the Python service are untouched; `git status` shows the result.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
