from relog import LOG_LEVELS, VALID_LEVELS, LogRecord, SamplingOptions, LoggerOptions


class TestLogLevels:
    def test_level_values(self):
        assert LOG_LEVELS["trace"] == 10
        assert LOG_LEVELS["debug"] == 20
        assert LOG_LEVELS["info"] == 30
        assert LOG_LEVELS["warn"] == 40
        assert LOG_LEVELS["error"] == 50
        assert LOG_LEVELS["fatal"] == 60

    def test_level_ordering(self):
        levels = ["trace", "debug", "info", "warn", "error", "fatal"]
        for i in range(len(levels) - 1):
            assert LOG_LEVELS[levels[i]] < LOG_LEVELS[levels[i + 1]]

    def test_valid_levels(self):
        assert VALID_LEVELS == {"trace", "debug", "info", "warn", "error", "fatal"}


class TestLogRecord:
    def test_defaults(self):
        record = LogRecord()
        assert record.timestamp == ""
        assert record.level == "info"
        assert record.message == ""
        assert record.meta is None
        assert record.service is None

    def test_to_dict_strips_none(self):
        record = LogRecord(
            timestamp="2026-01-01T00:00:00Z",
            level="info",
            message="test",
        )
        d = record.to_dict()
        assert "timestamp" in d
        assert "level" in d
        assert "message" in d
        assert "service" not in d
        assert "meta" not in d
        assert "host" not in d

    def test_to_dict_includes_set_fields(self):
        record = LogRecord(
            timestamp="2026-01-01T00:00:00Z",
            level="error",
            message="fail",
            service="api",
            meta={"key": "val"},
            trace_id="abc-123",
        )
        d = record.to_dict()
        assert d["service"] == "api"
        assert d["meta"] == {"key": "val"}
        assert d["trace_id"] == "abc-123"


class TestSamplingOptions:
    def test_defaults(self):
        opts = SamplingOptions()
        assert opts.sample_rate is None
        assert opts.slow_threshold_ms is None


class TestLoggerOptions:
    def test_defaults(self):
        opts = LoggerOptions()
        assert opts.url is None
        assert opts.service is None
        assert opts.batch_size is None
        assert opts.flush_interval is None
        assert opts.console is None

    def test_inherits_sampling(self):
        opts = LoggerOptions(sample_rate=0.5, slow_threshold_ms=1000)
        assert opts.sample_rate == 0.5
        assert opts.slow_threshold_ms == 1000
