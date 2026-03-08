from __future__ import annotations

import json
import sys
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ._types import LogLevel, LogRecord

_RESET = "\033[0m"
_DIM = "\033[2m"
_RED = "\033[31m"
_GREEN = "\033[32m"
_YELLOW = "\033[33m"
_BLUE = "\033[34m"
_MAGENTA = "\033[35m"
_CYAN = "\033[36m"
_GRAY = "\033[90m"
_BG_RED = "\033[41m"

_LEVEL_COLORS: dict[str, str] = {
    "trace": _GRAY,
    "debug": _CYAN,
    "info": _GREEN,
    "warn": _YELLOW,
    "error": _RED,
    "fatal": _BG_RED,
}

_use_colors: bool | None = None


def _colors_enabled() -> bool:
    global _use_colors
    if _use_colors is None:
        _use_colors = hasattr(sys.stdout, "isatty") and sys.stdout.isatty()
    return _use_colors


def _color(code: str, text: str) -> str:
    if not _colors_enabled():
        return text
    return f"{code}{text}{_RESET}"


def _dim(text: str) -> str:
    return _color(_DIM, text)


def format_log_record(record: LogRecord) -> str:
    time = record.timestamp[11:23]
    level_color = _LEVEL_COLORS.get(record.level, "")
    level_str = _color(level_color, record.level.upper().ljust(5))

    svc = f"[{_color(_BLUE, record.service)}] " if record.service else ""

    proj_parts = "@".join(filter(None, [record.project, record.branch]))
    ver = f"v{record.version}" if record.version else ""
    proj_label = " ".join(filter(None, [proj_parts, ver]))
    proj = f"[{_color(_MAGENTA, proj_label)}] " if proj_label else ""

    duration = ""
    if record.meta and isinstance(record.meta.get("duration_ms"), (int, float)):
        duration = f" {_dim(f'({record.meta["duration_ms"]}ms)')}"

    meta = ""
    if record.meta and len(record.meta) > 0:
        meta = f" {_dim(json.dumps(record.meta, default=str))}"

    return f"{_dim(time)} {level_str} {proj}{svc}{record.message}{duration}{meta}"


def print_log_record(record: LogRecord) -> None:
    formatted = format_log_record(record)
    if record.level in ("error", "fatal"):
        print(formatted, file=sys.stderr)
    elif record.level == "warn":
        print(formatted, file=sys.stderr)
    else:
        print(formatted)
