from __future__ import annotations

from dataclasses import dataclass, field, fields
from typing import Any, Literal

LogLevel = Literal["trace", "debug", "info", "warn", "error", "fatal"]

LOG_LEVELS: dict[str, int] = {
    "trace": 10,
    "debug": 20,
    "info": 30,
    "warn": 40,
    "error": 50,
    "fatal": 60,
}

VALID_LEVELS: set[str] = set(LOG_LEVELS.keys())


@dataclass
class SamplingOptions:
    sample_rate: float | None = None
    slow_threshold_ms: float | None = None


@dataclass
class LoggerOptions(SamplingOptions):
    url: str | None = None
    service: str | None = None
    auth: str | None = None
    level: LogLevel | None = None
    batch_size: int | None = None
    flush_interval: float | None = None
    max_buffer_size: int | None = None
    console: bool | None = None
    meta: dict[str, Any] | None = None
    trace_id: str | None = None
    span_id: str | None = None
    project: str | None = None
    branch: str | None = None
    version: str | None = None
    deployment_id: str | None = None
    on_error: Any | None = None


@dataclass
class LogRecord:
    timestamp: str = ""
    level: LogLevel = "info"
    message: str = ""
    meta: dict[str, Any] | None = None
    service: str | None = None
    host: str | None = None
    pid: int | None = None
    trace_id: str | None = None
    span_id: str | None = None
    project: str | None = None
    branch: str | None = None
    version: str | None = None
    deployment_id: str | None = None
    id: int | None = field(default=None, repr=False)
    created_at: int | None = field(default=None, repr=False)
    key_prefix: str | None = field(default=None, repr=False)

    def to_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for f in fields(self):
            val = getattr(self, f.name)
            if val is not None:
                result[f.name] = val
        return result
