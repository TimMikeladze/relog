from __future__ import annotations

import os
import subprocess

_cached_project: str | None = None
_cached_branch: str | None = None
_resolved = False


def _resolve_git() -> None:
    global _cached_project, _cached_branch, _resolved
    if _resolved:
        return
    _resolved = True

    try:
        result = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True,
            text=True,
            timeout=3,
        )
        if result.returncode == 0 and result.stdout:
            _cached_project = os.path.basename(result.stdout.strip())
    except Exception:
        pass

    try:
        result = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True,
            text=True,
            timeout=3,
        )
        if result.returncode == 0 and result.stdout:
            _cached_branch = result.stdout.strip()
    except Exception:
        pass


def infer_git_project() -> str | None:
    env = os.environ.get("RELOG_PROJECT")
    if env:
        return env
    _resolve_git()
    return _cached_project


def infer_git_branch() -> str | None:
    env = os.environ.get("RELOG_BRANCH")
    if env:
        return env
    _resolve_git()
    return _cached_branch
