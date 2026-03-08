from __future__ import annotations

import random
import time
import traceback
from typing import TYPE_CHECKING, Any, Callable
from urllib.parse import urlparse

if TYPE_CHECKING:
    from ._types import LogLevel, SamplingOptions

from ._types import LOG_LEVELS

EventSink = Callable[["LogLevel", str, dict[str, Any] | None], None]


class EventBuilder:
    def __init__(
        self,
        name: str,
        sink: EventSink,
        initial_meta: dict[str, Any] | None = None,
        sampling: SamplingOptions | None = None,
    ) -> None:
        self._name = name
        self._sink = sink
        self._data: dict[str, Any] = {}
        self._level: LogLevel = "info"
        self._start_time = time.perf_counter()
        self._ended = False
        self._force_keep = False
        self._sample_rate = sampling.sample_rate if sampling else None
        self._slow_threshold_ms = sampling.slow_threshold_ms if sampling else None

        if initial_meta:
            self._data.update(initial_meta)

    def set(self, key_or_obj: str | dict[str, Any], value: Any = None) -> EventBuilder:
        if isinstance(key_or_obj, str):
            self._data[key_or_obj] = value
        else:
            self._data.update(key_or_obj)
        return self

    def error(self, err: BaseException) -> EventBuilder:
        self._data["error"] = str(err)
        self._data["error_name"] = type(err).__name__
        self._data["error_stack"] = "".join(
            traceback.format_exception(type(err), err, err.__traceback__)
        )
        self._escalate("error")
        return self

    def warn(self, message: str | None = None) -> EventBuilder:
        if message:
            self._data["warning"] = message
        self._escalate("warn")
        return self

    def keep(self) -> EventBuilder:
        self._force_keep = True
        return self

    def request(
        self,
        *,
        method: str | None = None,
        url: str | None = None,
        headers: dict[str, str] | None = None,
    ) -> EventBuilder:
        if method:
            self._data["http_method"] = method
        if url:
            try:
                parsed = urlparse(url)
                self._data["http_path"] = parsed.path or url
            except Exception:
                self._data["http_path"] = url

        if headers:
            trace_id = headers.get("x-trace-id") or headers.get("x-request-id")
            if trace_id:
                self._data["trace_id"] = trace_id
            user_agent = headers.get("user-agent")
            if user_agent:
                self._data["user_agent"] = user_agent

        return self

    def response(self, *, status: int | None = None) -> EventBuilder:
        if status is not None:
            self._data["http_status"] = status
            if status >= 500:
                self._escalate("error")
        return self

    def end(self) -> None:
        if self._ended:
            return
        self._ended = True

        elapsed = time.perf_counter() - self._start_time
        duration_ms = round(elapsed * 1000, 2)

        if not self._should_keep(duration_ms):
            return

        meta: dict[str, Any] = {
            **self._data,
            "duration_ms": duration_ms,
            "event": True,
        }

        if self._sample_rate is not None and self._sample_rate < 1:
            meta["sample_rate"] = self._sample_rate

        self._sink(self._level, self._name, meta)

    def __enter__(self) -> EventBuilder:
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        if exc_val is not None and isinstance(exc_val, BaseException):
            self.error(exc_val)
        self.end()

    def _should_keep(self, duration_ms: float) -> bool:
        if self._force_keep:
            return True
        if LOG_LEVELS[self._level] >= LOG_LEVELS["error"]:
            return True
        if (
            self._slow_threshold_ms is not None
            and duration_ms > self._slow_threshold_ms
        ):
            return True

        rate = self._sample_rate
        if rate is None or rate >= 1:
            return True
        if rate <= 0:
            return False
        return random.random() < rate

    def _escalate(self, level: LogLevel) -> None:
        if LOG_LEVELS[level] > LOG_LEVELS[self._level]:
            self._level = level
