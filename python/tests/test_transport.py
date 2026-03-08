import json
import threading
import time

import httpx
import pytest

from relog import LogRecord, Transport


def _make_record(msg: str = "test") -> LogRecord:
    return LogRecord(
        timestamp="2026-01-15T10:30:45.123Z",
        level="info",
        message=msg,
    )


class TestTransportBuffering:
    def test_buffer_fills_and_flushes(self, httpx_mock):
        httpx_mock(200)
        transport = Transport(url="http://localhost:9999", batch_size=3, flush_interval=60.0)
        try:
            transport.send(_make_record("1"))
            transport.send(_make_record("2"))
            assert len(httpx_mock.requests) == 0
            transport.send(_make_record("3"))  # triggers flush at batch_size
            time.sleep(0.1)  # allow flush to complete
            assert len(httpx_mock.requests) >= 1
        finally:
            transport.destroy()

    def test_manual_flush(self, httpx_mock):
        httpx_mock(200)
        transport = Transport(url="http://localhost:9999", flush_interval=60.0)
        try:
            transport.send(_make_record())
            transport.flush()
            assert len(httpx_mock.requests) == 1
            body = httpx_mock.requests[0]
            assert body[0]["message"] == "test"
        finally:
            transport.destroy()

    def test_flush_empty_buffer_is_noop(self, httpx_mock):
        httpx_mock(200)
        transport = Transport(url="http://localhost:9999", flush_interval=60.0)
        try:
            transport.flush()
            assert len(httpx_mock.requests) == 0
        finally:
            transport.destroy()

    def test_buffer_eviction(self, httpx_mock):
        httpx_mock(200)
        transport = Transport(
            url="http://localhost:9999",
            max_buffer_size=10,
            batch_size=100,
            flush_interval=60.0,
        )
        try:
            for i in range(15):
                transport.send(_make_record(str(i)))
            transport.flush()
            assert len(httpx_mock.requests) == 1
            # Should have evicted oldest 10% on each overflow
            body = httpx_mock.requests[0]
            assert len(body) <= 10
        finally:
            transport.destroy()


class TestTransportAuth:
    def test_sends_auth_header(self, httpx_mock):
        httpx_mock(200)
        transport = Transport(
            url="http://localhost:9999",
            auth="my-token",
            flush_interval=60.0,
        )
        try:
            transport.send(_make_record())
            transport.flush()
            assert len(httpx_mock.requests) == 1
            assert httpx_mock.last_headers["authorization"] == "Bearer my-token"
        finally:
            transport.destroy()


class TestTransportDestroy:
    def test_destroy_stops_accepting(self, httpx_mock):
        httpx_mock(200)
        transport = Transport(url="http://localhost:9999", flush_interval=60.0)
        transport.destroy()
        transport.send(_make_record())
        transport.flush()
        assert len(httpx_mock.requests) == 0


class TestTransportRetry:
    def test_retries_on_500(self, httpx_mock):
        httpx_mock(500, then=200)
        transport = Transport(url="http://localhost:9999", flush_interval=60.0)
        try:
            transport.send(_make_record())
            transport.flush()
            assert len(httpx_mock.requests) == 2
        finally:
            transport.destroy()

    def test_no_retry_on_4xx(self, httpx_mock):
        errors = []
        httpx_mock(400)
        transport = Transport(
            url="http://localhost:9999",
            flush_interval=60.0,
            on_error=lambda err, batch: errors.append(str(err)),
        )
        try:
            transport.send(_make_record())
            transport.flush()
            assert len(httpx_mock.requests) == 1
            assert len(errors) == 1
            assert "400" in errors[0]
        finally:
            transport.destroy()

    def test_on_error_callback(self, httpx_mock):
        errors = []
        httpx_mock(500)
        transport = Transport(
            url="http://localhost:9999",
            flush_interval=60.0,
            on_error=lambda err, batch: errors.append((err, batch)),
        )
        try:
            transport.send(_make_record())
            transport.flush()
            assert len(errors) == 1
            assert len(errors[0][1]) == 1  # batch of 1
        finally:
            transport.destroy()


@pytest.fixture
def httpx_mock(monkeypatch):
    """Simple mock for httpx.Client that records requests."""

    class MockTransport:
        def __init__(self):
            self.requests = []
            self.last_headers = {}
            self._responses = []
            self._call_idx = 0

        def __call__(self, status_code, then=None):
            self._responses = [status_code]
            if then is not None:
                self._responses.append(then)
            return self

        def handle_request(self, request: httpx.Request) -> httpx.Response:
            body = json.loads(request.content)
            self.requests.append(body)
            self.last_headers = dict(request.headers)

            idx = min(self._call_idx, len(self._responses) - 1)
            status = self._responses[idx]
            self._call_idx += 1
            return httpx.Response(status_code=status)

    mock = MockTransport()

    original_init = httpx.Client.__init__

    def patched_init(self_client, **kwargs):
        original_init(self_client, **{**kwargs, "transport": mock})

    monkeypatch.setattr(httpx.Client, "__init__", patched_init)
    return mock
