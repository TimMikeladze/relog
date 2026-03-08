from __future__ import annotations

import os
import socket
import traceback
from datetime import datetime, timezone
from typing import Any

from ._console import print_log_record
from ._event import EventBuilder
from ._git import infer_git_branch, infer_git_project
from ._transport import Transport
from ._types import LOG_LEVELS, LogLevel, LogRecord, LoggerOptions, SamplingOptions

_HOSTNAME = socket.gethostname()
_PID = os.getpid()


def _resolve_level(explicit: LogLevel | None) -> LogLevel:
    if explicit:
        return explicit
    env = os.environ.get("LOG_LEVEL") or os.environ.get("RELOG_LEVEL")
    if env and env in LOG_LEVELS:
        return env  # type: ignore[return-value]
    return "info"


def _resolve_auth(explicit: str | None) -> str | None:
    return explicit or os.environ.get("RELOG_AUTH")


def _serialize_error(err: BaseException) -> dict[str, Any]:
    return {
        "error": str(err),
        "name": type(err).__name__,
        "stack": "".join(
            traceback.format_exception(type(err), err, err.__traceback__)
        ),
    }


class Logger:
    def __init__(
        self,
        options: LoggerOptions | None = None,
        _parent_transport: Transport | None = None,
    ) -> None:
        opts = options or LoggerOptions()

        self._service = opts.service
        self._level = _resolve_level(opts.level)
        self._console_enabled = opts.console if opts.console is not None else True
        self._bound_meta: dict[str, Any] = dict(opts.meta) if opts.meta else {}
        self._trace_id = opts.trace_id
        self._span_id = opts.span_id
        self._project = opts.project or infer_git_project()
        self._branch = opts.branch or infer_git_branch()
        self._version = opts.version
        self._deployment_id = opts.deployment_id
        self._host = _HOSTNAME
        self._pid = _PID
        self._is_child = _parent_transport is not None
        self._sample_rate = opts.sample_rate
        self._slow_threshold_ms = opts.slow_threshold_ms

        if _parent_transport:
            self._transport: Transport | None = _parent_transport
        elif opts.url:
            self._transport = Transport(
                url=opts.url,
                auth=_resolve_auth(opts.auth),
                batch_size=opts.batch_size or 50,
                flush_interval=opts.flush_interval or 5.0,
                max_buffer_size=opts.max_buffer_size or 10_000,
                on_error=opts.on_error,
            )
        else:
            self._transport = None

    def child(
        self,
        *,
        trace_id: str | None = None,
        span_id: str | None = None,
        project: str | None = None,
        branch: str | None = None,
        version: str | None = None,
        deployment_id: str | None = None,
        sample_rate: float | None = None,
        slow_threshold_ms: float | None = None,
        meta: dict[str, Any] | None = None,
    ) -> Logger:
        merged_meta = {**self._bound_meta, **(meta or {})}
        child_opts = LoggerOptions(
            service=self._service,
            level=self._level,
            console=self._console_enabled,
            meta=merged_meta,
            trace_id=trace_id or self._trace_id,
            span_id=span_id or self._span_id,
            project=project or self._project,
            branch=branch or self._branch,
            version=version or self._version,
            deployment_id=deployment_id or self._deployment_id,
            sample_rate=sample_rate if sample_rate is not None else self._sample_rate,
            slow_threshold_ms=slow_threshold_ms
            if slow_threshold_ms is not None
            else self._slow_threshold_ms,
        )
        return Logger(child_opts, self._transport or None)

    def set_level(self, level: LogLevel) -> None:
        self._level = level

    def _log(
        self,
        level: LogLevel,
        message_or_error: str | BaseException,
        meta: dict[str, Any] | None = None,
    ) -> None:
        if LOG_LEVELS[level] < LOG_LEVELS[self._level]:
            return

        if isinstance(message_or_error, BaseException):
            message = str(message_or_error)
            final_meta = {
                **self._bound_meta,
                **_serialize_error(message_or_error),
                **(meta or {}),
            }
        else:
            message = message_or_error
            merged = {**self._bound_meta, **(meta or {})}
            final_meta = merged if merged else None  # type: ignore[assignment]

        record = LogRecord(
            timestamp=datetime.now(timezone.utc).isoformat(),
            level=level,
            message=message,
            meta=final_meta,
            service=self._service,
            host=self._host,
            pid=self._pid,
            trace_id=self._trace_id,
            span_id=self._span_id,
            project=self._project,
            branch=self._branch,
            version=self._version,
            deployment_id=self._deployment_id,
        )

        if self._console_enabled:
            print_log_record(record)

        if self._transport:
            self._transport.send(record)

    def trace(
        self, message: str | BaseException, meta: dict[str, Any] | None = None
    ) -> None:
        self._log("trace", message, meta)

    def debug(
        self, message: str | BaseException, meta: dict[str, Any] | None = None
    ) -> None:
        self._log("debug", message, meta)

    def info(
        self, message: str | BaseException, meta: dict[str, Any] | None = None
    ) -> None:
        self._log("info", message, meta)

    def warn(
        self, message: str | BaseException, meta: dict[str, Any] | None = None
    ) -> None:
        self._log("warn", message, meta)

    def error(
        self, message: str | BaseException, meta: dict[str, Any] | None = None
    ) -> None:
        self._log("error", message, meta)

    def fatal(
        self, message: str | BaseException, meta: dict[str, Any] | None = None
    ) -> None:
        self._log("fatal", message, meta)

    def event(
        self, name: str, meta: dict[str, Any] | None = None
    ) -> EventBuilder:
        sampling = SamplingOptions(
            sample_rate=self._sample_rate,
            slow_threshold_ms=self._slow_threshold_ms,
        )
        return EventBuilder(
            name,
            lambda level, msg, m: self._log(level, msg, m),
            {**self._bound_meta, **(meta or {})},
            sampling,
        )

    def flush(self) -> None:
        if self._transport:
            self._transport.flush()

    def destroy(self) -> None:
        if self._transport and not self._is_child:
            self._transport.flush()
            self._transport.destroy()


def create_logger(
    url: str | None = None,
    *,
    service: str | None = None,
    auth: str | None = None,
    level: LogLevel | None = None,
    batch_size: int | None = None,
    flush_interval: float | None = None,
    max_buffer_size: int | None = None,
    console: bool | None = None,
    meta: dict[str, Any] | None = None,
    trace_id: str | None = None,
    span_id: str | None = None,
    project: str | None = None,
    branch: str | None = None,
    version: str | None = None,
    deployment_id: str | None = None,
    sample_rate: float | None = None,
    slow_threshold_ms: float | None = None,
    on_error: Any | None = None,
) -> Logger:
    opts = LoggerOptions(
        url=url,
        service=service,
        auth=auth,
        level=level,
        batch_size=batch_size,
        flush_interval=flush_interval,
        max_buffer_size=max_buffer_size,
        console=console,
        meta=meta,
        trace_id=trace_id,
        span_id=span_id,
        project=project,
        branch=branch,
        version=version,
        deployment_id=deployment_id,
        sample_rate=sample_rate,
        slow_threshold_ms=slow_threshold_ms,
        on_error=on_error,
    )
    return Logger(opts)
