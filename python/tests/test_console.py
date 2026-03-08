from relog import LogRecord, format_log_record, print_log_record
from relog._console import _use_colors
import relog._console as console_mod


class TestFormatLogRecord:
    def setup_method(self):
        # Force colors off for predictable test output
        console_mod._use_colors = False

    def teardown_method(self):
        console_mod._use_colors = None

    def test_basic_format(self):
        record = LogRecord(
            timestamp="2026-01-15T10:30:45.123Z",
            level="info",
            message="hello world",
        )
        result = format_log_record(record)
        assert "10:30:45.123" in result
        assert "INFO" in result
        assert "hello world" in result

    def test_includes_service(self):
        record = LogRecord(
            timestamp="2026-01-15T10:30:45.123Z",
            level="info",
            message="test",
            service="api",
        )
        result = format_log_record(record)
        assert "[api]" in result

    def test_includes_project_and_branch(self):
        record = LogRecord(
            timestamp="2026-01-15T10:30:45.123Z",
            level="info",
            message="test",
            project="myapp",
            branch="main",
        )
        result = format_log_record(record)
        assert "[myapp@main]" in result

    def test_includes_version(self):
        record = LogRecord(
            timestamp="2026-01-15T10:30:45.123Z",
            level="info",
            message="test",
            project="myapp",
            version="1.2.3",
        )
        result = format_log_record(record)
        assert "v1.2.3" in result

    def test_includes_duration(self):
        record = LogRecord(
            timestamp="2026-01-15T10:30:45.123Z",
            level="info",
            message="test",
            meta={"duration_ms": 42.5},
        )
        result = format_log_record(record)
        assert "(42.5ms)" in result

    def test_includes_meta(self):
        record = LogRecord(
            timestamp="2026-01-15T10:30:45.123Z",
            level="info",
            message="test",
            meta={"key": "val"},
        )
        result = format_log_record(record)
        assert '"key"' in result
        assert '"val"' in result

    def test_level_padding(self):
        for level in ["trace", "debug", "info", "warn", "error", "fatal"]:
            record = LogRecord(
                timestamp="2026-01-15T10:30:45.123Z",
                level=level,
                message="test",
            )
            result = format_log_record(record)
            assert level.upper() in result


class TestPrintLogRecord:
    def setup_method(self):
        console_mod._use_colors = False

    def teardown_method(self):
        console_mod._use_colors = None

    def test_info_to_stdout(self, capsys):
        record = LogRecord(
            timestamp="2026-01-15T10:30:45.123Z",
            level="info",
            message="stdout test",
        )
        print_log_record(record)
        captured = capsys.readouterr()
        assert "stdout test" in captured.out
        assert captured.err == ""

    def test_error_to_stderr(self, capsys):
        record = LogRecord(
            timestamp="2026-01-15T10:30:45.123Z",
            level="error",
            message="stderr test",
        )
        print_log_record(record)
        captured = capsys.readouterr()
        assert "stderr test" in captured.err
        assert captured.out == ""

    def test_warn_to_stderr(self, capsys):
        record = LogRecord(
            timestamp="2026-01-15T10:30:45.123Z",
            level="warn",
            message="warn test",
        )
        print_log_record(record)
        captured = capsys.readouterr()
        assert "warn test" in captured.err
