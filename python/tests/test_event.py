import time

import pytest

from relog._event import EventBuilder
from relog._types import SamplingOptions


class TestEventBuilder:
    def _capture_sink(self):
        captured = []

        def sink(level, message, meta=None):
            captured.append({"level": level, "message": message, "meta": meta})

        return captured, sink

    def test_basic_end(self):
        captured, sink = self._capture_sink()
        ev = EventBuilder("test-event", sink)
        ev.end()
        assert len(captured) == 1
        assert captured[0]["level"] == "info"
        assert captured[0]["message"] == "test-event"
        assert captured[0]["meta"]["event"] is True
        assert "duration_ms" in captured[0]["meta"]

    def test_set_key_value(self):
        captured, sink = self._capture_sink()
        ev = EventBuilder("test", sink)
        ev.set("key", "val")
        ev.end()
        assert captured[0]["meta"]["key"] == "val"

    def test_set_dict(self):
        captured, sink = self._capture_sink()
        ev = EventBuilder("test", sink)
        ev.set({"a": 1, "b": 2})
        ev.end()
        assert captured[0]["meta"]["a"] == 1
        assert captured[0]["meta"]["b"] == 2

    def test_fluent_api(self):
        captured, sink = self._capture_sink()
        ev = EventBuilder("test", sink)
        result = ev.set("k", "v").warn("hmm").keep()
        assert result is ev
        ev.end()
        assert captured[0]["level"] == "warn"

    def test_error_escalates(self):
        captured, sink = self._capture_sink()
        ev = EventBuilder("test", sink)
        ev.error(ValueError("bad"))
        ev.end()
        assert captured[0]["level"] == "error"
        assert captured[0]["meta"]["error"] == "bad"
        assert captured[0]["meta"]["error_name"] == "ValueError"
        assert "error_stack" in captured[0]["meta"]

    def test_warn_escalates(self):
        captured, sink = self._capture_sink()
        ev = EventBuilder("test", sink)
        ev.warn("careful")
        ev.end()
        assert captured[0]["level"] == "warn"
        assert captured[0]["meta"]["warning"] == "careful"

    def test_no_double_end(self):
        captured, sink = self._capture_sink()
        ev = EventBuilder("test", sink)
        ev.end()
        ev.end()
        assert len(captured) == 1

    def test_initial_meta(self):
        captured, sink = self._capture_sink()
        ev = EventBuilder("test", sink, initial_meta={"req_id": "abc"})
        ev.end()
        assert captured[0]["meta"]["req_id"] == "abc"

    def test_duration_tracking(self):
        captured, sink = self._capture_sink()
        ev = EventBuilder("test", sink)
        time.sleep(0.05)
        ev.end()
        duration = captured[0]["meta"]["duration_ms"]
        assert duration >= 40  # at least ~50ms with some tolerance

    def test_request_method(self):
        captured, sink = self._capture_sink()
        ev = EventBuilder("test", sink)
        ev.request(method="GET", url="/api/users", headers={"x-trace-id": "t123"})
        ev.end()
        assert captured[0]["meta"]["http_method"] == "GET"
        assert captured[0]["meta"]["http_path"] == "/api/users"
        assert captured[0]["meta"]["trace_id"] == "t123"

    def test_response_escalates_on_500(self):
        captured, sink = self._capture_sink()
        ev = EventBuilder("test", sink)
        ev.response(status=503)
        ev.end()
        assert captured[0]["level"] == "error"
        assert captured[0]["meta"]["http_status"] == 503

    def test_response_no_escalate_on_200(self):
        captured, sink = self._capture_sink()
        ev = EventBuilder("test", sink)
        ev.response(status=200)
        ev.end()
        assert captured[0]["level"] == "info"

    def test_keep_forces_emit(self):
        captured, sink = self._capture_sink()
        sampling = SamplingOptions(sample_rate=0.0)
        ev = EventBuilder("test", sink, sampling=sampling)
        ev.keep()
        ev.end()
        assert len(captured) == 1

    def test_sample_rate_zero_drops(self):
        captured, sink = self._capture_sink()
        sampling = SamplingOptions(sample_rate=0.0)
        ev = EventBuilder("test", sink, sampling=sampling)
        ev.end()
        assert len(captured) == 0

    def test_error_level_always_kept(self):
        captured, sink = self._capture_sink()
        sampling = SamplingOptions(sample_rate=0.0)
        ev = EventBuilder("test", sink, sampling=sampling)
        ev.error(RuntimeError("fail"))
        ev.end()
        assert len(captured) == 1

    def test_sample_rate_in_meta(self):
        captured, sink = self._capture_sink()
        sampling = SamplingOptions(sample_rate=0.5)
        ev = EventBuilder("test", sink, sampling=sampling)
        ev.keep()  # force keep so it always emits
        ev.end()
        assert captured[0]["meta"]["sample_rate"] == 0.5


class TestEventBuilderContextManager:
    def _capture_sink(self):
        captured = []

        def sink(level, message, meta=None):
            captured.append({"level": level, "message": message, "meta": meta})

        return captured, sink

    def test_context_manager_ends(self):
        captured, sink = self._capture_sink()
        with EventBuilder("test", sink) as ev:
            ev.set("x", 1)
        assert len(captured) == 1
        assert captured[0]["meta"]["x"] == 1

    def test_context_manager_captures_exception(self):
        captured, sink = self._capture_sink()
        with pytest.raises(ValueError, match="oops"):
            with EventBuilder("test", sink) as ev:
                raise ValueError("oops")
        assert len(captured) == 1
        assert captured[0]["level"] == "error"
        assert captured[0]["meta"]["error"] == "oops"

    def test_context_manager_exception_escalates(self):
        captured, sink = self._capture_sink()
        try:
            with EventBuilder("test", sink) as ev:
                raise ValueError("oops")
        except ValueError:
            pass
        assert len(captured) == 1
        assert captured[0]["level"] == "error"
        assert captured[0]["meta"]["error"] == "oops"
        assert captured[0]["meta"]["error_name"] == "ValueError"
