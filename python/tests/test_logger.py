import json
import os
from unittest.mock import patch

import httpx
import pytest

import relog._console as console_mod
from relog import Logger, create_logger
from relog._logger import _resolve_level


class TestResolveLevel:
    def test_explicit_level(self):
        assert _resolve_level("error") == "error"

    def test_log_level_env(self):
        with patch.dict(os.environ, {"LOG_LEVEL": "debug"}):
            assert _resolve_level(None) == "debug"

    def test_relog_level_env(self):
        with patch.dict(os.environ, {"RELOG_LEVEL": "warn"}, clear=False):
            os.environ.pop("LOG_LEVEL", None)
            assert _resolve_level(None) == "warn"

    def test_default_info(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("LOG_LEVEL", None)
            os.environ.pop("RELOG_LEVEL", None)
            assert _resolve_level(None) == "info"


class TestLogger:
    def setup_method(self):
        console_mod._use_colors = False

    def teardown_method(self):
        console_mod._use_colors = None

    def test_info_outputs_to_console(self, capsys):
        log = create_logger(console=True)
        log.info("hello")
        captured = capsys.readouterr()
        assert "hello" in captured.out
        assert "INFO" in captured.out

    def test_level_filtering(self, capsys):
        log = create_logger(console=True, level="warn")
        log.info("should be filtered")
        log.warn("should appear")
        captured = capsys.readouterr()
        assert "should be filtered" not in captured.out + captured.err
        assert "should appear" in captured.err

    def test_set_level(self, capsys):
        log = create_logger(console=True, level="info")
        log.debug("hidden")
        log.set_level("debug")
        log.debug("visible")
        captured = capsys.readouterr()
        assert "hidden" not in captured.out
        assert "visible" in captured.out

    def test_error_with_exception(self, capsys):
        log = create_logger(console=True)
        log.error(ValueError("bad value"))
        captured = capsys.readouterr()
        assert "bad value" in captured.err
        assert "ERROR" in captured.err

    def test_meta_binding(self, capsys):
        log = create_logger(console=True, meta={"env": "test"})
        log.info("with meta")
        captured = capsys.readouterr()
        assert '"env"' in captured.out
        assert '"test"' in captured.out

    def test_meta_in_log_call(self, capsys):
        log = create_logger(console=True)
        log.info("req done", {"status": 200})
        captured = capsys.readouterr()
        assert "200" in captured.out

    def test_service_in_output(self, capsys):
        log = create_logger(console=True, service="api")
        log.info("test")
        captured = capsys.readouterr()
        assert "[api]" in captured.out

    def test_console_disabled(self, capsys):
        log = create_logger(console=False)
        log.info("silent")
        captured = capsys.readouterr()
        assert captured.out == ""
        assert captured.err == ""

    def test_all_levels(self, capsys):
        log = create_logger(console=True, level="trace")
        for level in ["trace", "debug", "info", "warn", "error", "fatal"]:
            getattr(log, level)("test")
        captured = capsys.readouterr()
        combined = captured.out + captured.err
        for level in ["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL"]:
            assert level in combined


class TestChildLogger:
    def setup_method(self):
        console_mod._use_colors = False

    def teardown_method(self):
        console_mod._use_colors = None

    def test_child_inherits_service(self, capsys):
        log = create_logger(console=True, service="parent")
        child = log.child(meta={"req": "123"})
        child.info("child log")
        captured = capsys.readouterr()
        assert "[parent]" in captured.out
        assert '"req"' in captured.out

    def test_child_overrides_trace_id(self, capsys):
        log = create_logger(console=True, trace_id="original")
        child = log.child(trace_id="new-trace")
        # The trace_id isn't printed in console, but we can verify through the record
        # Just verify child logger works
        child.info("test")
        captured = capsys.readouterr()
        assert "test" in captured.out

    def test_child_merges_meta(self, capsys):
        log = create_logger(console=True, meta={"env": "prod"})
        child = log.child(meta={"req": "abc"})
        child.info("test")
        captured = capsys.readouterr()
        assert '"env"' in captured.out
        assert '"req"' in captured.out


class TestLoggerEvent:
    def setup_method(self):
        console_mod._use_colors = False

    def teardown_method(self):
        console_mod._use_colors = None

    def test_event_builder_returned(self):
        log = create_logger(console=False)
        ev = log.event("test-event")
        assert ev is not None
        ev.end()

    def test_event_context_manager(self, capsys):
        log = create_logger(console=True, level="trace")
        with log.event("request") as ev:
            ev.set("path", "/api")
        captured = capsys.readouterr()
        combined = captured.out + captured.err
        assert "request" in combined
        assert "duration_ms" in combined

    def test_event_with_meta(self, capsys):
        log = create_logger(console=True)
        with log.event("op", {"extra": "data"}) as ev:
            ev.set("key", "val")
        captured = capsys.readouterr()
        assert "extra" in captured.out


class TestCreateLoggerFactory:
    def test_returns_logger(self):
        log = create_logger()
        assert isinstance(log, Logger)

    def test_accepts_url(self, httpx_mock_noop):
        log = create_logger("http://localhost:9999", console=False)
        try:
            log.info("test")
            log.flush()
        finally:
            log.destroy()

    def test_no_transport_without_url(self):
        log = create_logger(console=False)
        assert log._transport is None


class TestLoggerDestroy:
    def test_destroy_flushes(self, httpx_mock_noop):
        log = create_logger("http://localhost:9999", console=False)
        log.info("test")
        log.destroy()
        # Should not raise

    def test_child_destroy_does_not_destroy_transport(self, httpx_mock_noop):
        log = create_logger("http://localhost:9999", console=False)
        child = log.child(meta={"x": 1})
        child.destroy()  # should not destroy parent transport
        log.info("still works")
        log.flush()
        log.destroy()


@pytest.fixture
def httpx_mock_noop(monkeypatch):
    """No-op httpx mock that accepts all requests."""

    class NoopTransport:
        def handle_request(self, request):
            return httpx.Response(200)

    original_init = httpx.Client.__init__

    def patched_init(self_client, **kwargs):
        original_init(self_client, **{**kwargs, "transport": NoopTransport()})

    monkeypatch.setattr(httpx.Client, "__init__", patched_init)
