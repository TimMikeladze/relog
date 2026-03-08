"""Integration tests that start the relog server and verify end-to-end logging."""

import subprocess
import time

import httpx
import pytest

import relog


@pytest.fixture(scope="module")
def server():
    """Start the relog server on a test port and tear it down after tests."""
    port = 13485
    proc = subprocess.Popen(
        ["bun", "src/cli.ts", "start", "--port", str(port), "--cors", "true"],
        cwd=subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True,
            text=True,
        ).stdout.strip(),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    url = f"http://localhost:{port}"

    # Wait for server to be ready
    for _ in range(30):
        try:
            r = httpx.get(f"{url}/health", timeout=1.0)
            if r.is_success:
                break
        except Exception:
            pass
        time.sleep(0.2)
    else:
        proc.kill()
        pytest.fail("Server did not start in time")

    yield url

    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()


class TestIntegration:
    def test_health_endpoint(self, server: str):
        r = httpx.get(f"{server}/health")
        assert r.is_success
        data = r.json()
        assert data["ok"] is True

    def test_send_and_query_log(self, server: str):
        log = relog.create_logger(server, console=False, service="pytest")
        log.info("integration test message", {"test_key": "test_val"})
        log.flush()

        # Give server a moment to process
        time.sleep(0.3)

        r = httpx.get(
            f"{server}/logs",
            params={"service": "pytest", "limit": "10"},
        )
        assert r.is_success
        data = r.json()
        assert len(data["rows"]) >= 1
        found = any(
            entry["message"] == "integration test message" for entry in data["rows"]
        )
        assert found, f"Expected log not found in {data['rows']}"

    def test_send_multiple_levels(self, server: str):
        log = relog.create_logger(server, console=False, service="pytest-levels", level="debug")
        log.debug("debug msg")
        log.info("info msg")
        log.warn("warn msg")
        log.error("error msg")
        log.flush()

        time.sleep(0.3)

        r = httpx.get(
            f"{server}/logs",
            params={"service": "pytest-levels", "limit": "10"},
        )
        assert r.is_success
        rows = r.json()["rows"]
        messages = {entry["message"] for entry in rows}
        assert "debug msg" in messages
        assert "info msg" in messages
        assert "warn msg" in messages
        assert "error msg" in messages

    def test_event_builder(self, server: str):
        log = relog.create_logger(server, console=False, service="pytest-event")
        with log.event("test-operation") as ev:
            ev.set("step", "processing")
            time.sleep(0.05)
        log.flush()

        time.sleep(0.3)

        r = httpx.get(
            f"{server}/logs",
            params={"service": "pytest-event", "limit": "10"},
        )
        assert r.is_success
        rows = r.json()["rows"]
        event_logs = [e for e in rows if e["message"] == "test-operation"]
        assert len(event_logs) >= 1
        meta = event_logs[0].get("meta", {})
        assert meta.get("event") is True
        assert "duration_ms" in meta
        assert meta["duration_ms"] >= 40

    def test_child_logger(self, server: str):
        log = relog.create_logger(server, console=False, service="pytest-child")
        child = log.child(trace_id="trace-abc", meta={"req_id": "r123"})
        child.info("child message")
        log.flush()

        time.sleep(0.3)

        r = httpx.get(
            f"{server}/logs",
            params={"service": "pytest-child", "limit": "10"},
        )
        assert r.is_success
        rows = r.json()["rows"]
        found = [e for e in rows if e["message"] == "child message"]
        assert len(found) >= 1
        assert found[0]["trace_id"] == "trace-abc"

    def test_error_with_exception(self, server: str):
        log = relog.create_logger(server, console=False, service="pytest-exc")
        try:
            raise ValueError("test error")
        except ValueError as exc:
            log.error(exc)
        log.flush()

        time.sleep(0.3)

        r = httpx.get(
            f"{server}/logs",
            params={"service": "pytest-exc", "limit": "10"},
        )
        assert r.is_success
        rows = r.json()["rows"]
        found = [e for e in rows if e["message"] == "test error"]
        assert len(found) >= 1
        meta = found[0].get("meta", {})
        assert meta.get("name") == "ValueError"
        assert "stack" in meta

    def test_destroy(self, server: str):
        log = relog.create_logger(server, console=False, service="pytest-destroy")
        log.info("before destroy")
        log.destroy()
        # Should not raise, and logs should have been flushed
