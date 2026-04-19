import pytest

from relog import EventBuilder, SpanKind, SpanStatusCode, otel_meta


class TestOtelMeta:
    def test_empty_marks_otel(self):
        m = otel_meta()
        assert m == {"otel": True}

    def test_kind_valid(self):
        m = otel_meta(kind="server")
        assert m["span_kind"] == "server"
        assert m["otel"] is True

    def test_kind_invalid_raises(self):
        with pytest.raises(ValueError):
            otel_meta(kind="bogus")  # type: ignore[arg-type]

    def test_status_with_message(self):
        m = otel_meta(status_code=SpanStatusCode.ERROR, status_message="boom")
        assert m["span_status_code"] == 2
        assert m["span_status_message"] == "boom"

    def test_status_invalid_raises(self):
        with pytest.raises(ValueError):
            otel_meta(status_code=99)

    def test_scope_name_only(self):
        m = otel_meta(scope_name="my.scope")
        assert m["instrumentation_scope"] == {"name": "my.scope"}

    def test_scope_with_version(self):
        m = otel_meta(scope_name="my.scope", scope_version="1.2.3")
        assert m["instrumentation_scope"] == {"name": "my.scope", "version": "1.2.3"}

    def test_resource(self):
        m = otel_meta(resource={"service.name": "api", "deployment.environment": "prod"})
        assert m["resource"] == {
            "service.name": "api",
            "deployment.environment": "prod",
        }

    def test_span_kind_constants(self):
        assert SpanKind.SERVER == "server"
        assert SpanKind.CLIENT == "client"
        assert SpanKind.INTERNAL == "internal"
        assert SpanKind.PRODUCER == "producer"
        assert SpanKind.CONSUMER == "consumer"

    def test_status_code_constants(self):
        assert SpanStatusCode.UNSET == 0
        assert SpanStatusCode.OK == 1
        assert SpanStatusCode.ERROR == 2


class TestEventBuilderOtel:
    def _capture_sink(self):
        captured: list[dict] = []

        def sink(level, message, meta=None):
            captured.append({"level": level, "message": message, "meta": meta})

        return captured, sink

    def test_kind_sets_otel_fields(self):
        captured, sink = self._capture_sink()
        ev = EventBuilder("test", sink)
        ev.kind(SpanKind.SERVER).end()
        assert captured[0]["meta"]["otel"] is True
        assert captured[0]["meta"]["span_kind"] == "server"

    def test_status_ok(self):
        captured, sink = self._capture_sink()
        ev = EventBuilder("test", sink)
        ev.status(SpanStatusCode.OK).end()
        assert captured[0]["meta"]["span_status_code"] == 1
        assert captured[0]["level"] == "info"

    def test_status_error_escalates(self):
        captured, sink = self._capture_sink()
        ev = EventBuilder("test", sink)
        ev.status(SpanStatusCode.ERROR, "db down").end()
        assert captured[0]["level"] == "error"
        assert captured[0]["meta"]["span_status_code"] == 2
        assert captured[0]["meta"]["span_status_message"] == "db down"

    def test_scope(self):
        captured, sink = self._capture_sink()
        ev = EventBuilder("test", sink)
        ev.scope("my.lib", "0.1.0").end()
        assert captured[0]["meta"]["instrumentation_scope"] == {
            "name": "my.lib",
            "version": "0.1.0",
        }

    def test_resource_merges(self):
        captured, sink = self._capture_sink()
        ev = EventBuilder("test", sink)
        ev.resource({"service.name": "api"}).resource({"deployment.environment": "prod"}).end()
        resource = captured[0]["meta"]["resource"]
        assert resource["service.name"] == "api"
        assert resource["deployment.environment"] == "prod"

    def test_error_sets_span_status_when_otel(self):
        captured, sink = self._capture_sink()
        ev = EventBuilder("test", sink)
        ev.kind(SpanKind.SERVER).error(RuntimeError("fail")).end()
        meta = captured[0]["meta"]
        assert meta["span_status_code"] == 2
        assert meta["span_status_message"] == "fail"
        assert captured[0]["level"] == "error"

    def test_error_without_otel_does_not_set_status(self):
        captured, sink = self._capture_sink()
        ev = EventBuilder("test", sink)
        ev.error(RuntimeError("fail")).end()
        meta = captured[0]["meta"]
        assert "span_status_code" not in meta

    def test_fluent_chain(self):
        captured, sink = self._capture_sink()
        with EventBuilder("http-request", sink) as ev:
            ev.kind(SpanKind.SERVER).scope("relog.http", "1.0.0").resource(
                {"service.name": "api", "service.version": "1.2.3"}
            ).status(SpanStatusCode.OK)
        meta = captured[0]["meta"]
        assert meta["otel"] is True
        assert meta["span_kind"] == "server"
        assert meta["span_status_code"] == 1
        assert meta["instrumentation_scope"]["name"] == "relog.http"
        assert meta["resource"]["service.name"] == "api"
