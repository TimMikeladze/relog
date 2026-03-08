from __future__ import annotations

import atexit
import math
import sys
import threading
import time
from typing import TYPE_CHECKING, Any

import httpx

if TYPE_CHECKING:
    from ._types import LogRecord

_active_transports: set[Transport] = set()
_atexit_registered = False


def _register_atexit() -> None:
    global _atexit_registered
    if _atexit_registered:
        return
    _atexit_registered = True

    def _flush_all() -> None:
        for t in list(_active_transports):
            try:
                t.flush()
            except Exception:
                pass

    atexit.register(_flush_all)


class Transport:
    def __init__(
        self,
        *,
        url: str,
        auth: str | None = None,
        batch_size: int = 50,
        flush_interval: float = 5.0,
        max_buffer_size: int = 10_000,
        on_error: Any | None = None,
    ) -> None:
        self._url = url
        self._auth = auth
        self._batch_size = batch_size
        self._flush_interval = flush_interval
        self._max_buffer_size = max_buffer_size
        self._on_error = on_error

        self._buffer: list[LogRecord] = []
        self._lock = threading.Lock()
        self._flushing = False
        self._pending_flush = False
        self._destroyed = False
        self._client: httpx.Client | None = None

        self._stop_event = threading.Event()
        self._timer_thread = threading.Thread(target=self._timer_loop, daemon=True)
        self._timer_thread.start()

        _active_transports.add(self)
        _register_atexit()

    def _get_client(self) -> httpx.Client:
        if self._client is None:
            self._client = httpx.Client(timeout=30.0)
        return self._client

    def _timer_loop(self) -> None:
        while not self._stop_event.wait(self._flush_interval):
            try:
                self.flush()
            except Exception:
                pass

    def send(self, record: LogRecord) -> None:
        if self._destroyed:
            return
        with self._lock:
            if len(self._buffer) >= self._max_buffer_size:
                drop = math.floor(self._max_buffer_size * 0.1)
                del self._buffer[:drop]
            self._buffer.append(record)
            should_flush = len(self._buffer) >= self._batch_size
        if should_flush:
            self.flush()

    def flush(self) -> None:
        with self._lock:
            if self._flushing:
                self._pending_flush = True
                return
            if not self._buffer:
                return
            self._flushing = True
            self._pending_flush = False
            batch = list(self._buffer)
            self._buffer.clear()

        try:
            self._send_batch(batch)
        finally:
            with self._lock:
                self._flushing = False
                needs_reflush = (
                    not self._destroyed
                    and self._pending_flush
                    and len(self._buffer) > 0
                )
            if needs_reflush:
                self.flush()

    def _send_batch(self, batch: list[LogRecord]) -> None:
        headers: dict[str, str] = {"Content-Type": "application/json"}
        if self._auth:
            headers["Authorization"] = f"Bearer {self._auth}"

        payload = [r.to_dict() for r in batch]
        last_error: Exception | None = None
        client = self._get_client()

        for attempt in range(3):
            if self._destroyed:
                return

            try:
                response = client.post(
                    f"{self._url}/ingest",
                    json=payload,
                    headers=headers,
                )

                if response.is_success:
                    return

                if response.status_code == 429:
                    retry_after = response.headers.get("Retry-After")
                    wait = int(retry_after) if retry_after else 10
                    last_error = Exception("Rate limited (429)")
                    if attempt < 2 and not self._destroyed:
                        time.sleep(wait)
                    continue

                if response.status_code < 500:
                    last_error = Exception(
                        f"Ingest rejected: {response.status_code}"
                    )
                    break

                last_error = Exception(f"Ingest failed: {response.status_code}")
            except Exception as exc:
                last_error = exc

            if attempt < 2 and not self._destroyed:
                delay = min(2**attempt * 0.5, 5.0)
                time.sleep(delay)

        if last_error:
            if self._on_error:
                try:
                    self._on_error(last_error, batch)
                except Exception:
                    pass
            else:
                print(
                    f"[relog] Failed to send {len(batch)} log(s): {last_error}",
                    file=sys.stderr,
                )

    def destroy(self) -> None:
        self._destroyed = True
        self._stop_event.set()
        _active_transports.discard(self)
        if self._client:
            try:
                self._client.close()
            except Exception:
                pass
            self._client = None
