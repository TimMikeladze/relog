"""OpenTelemetry-shaped metadata helpers for relog.

Produces the same meta keys the relog server's OTLP receiver and UI understand:
``otel``, ``span_kind``, ``span_status_code``, ``span_status_message``,
``instrumentation_scope``, ``resource``. Consumers can either use
:func:`otel_meta` to build a meta dict directly, or call the OTel-aware
methods on :class:`relog.EventBuilder` (``.kind``, ``.status``, ``.scope``,
``.resource``) which route through this module.
"""

from __future__ import annotations

from typing import Any, Literal

SpanKindName = Literal["unspecified", "internal", "server", "client", "producer", "consumer"]


class SpanKind:
    UNSPECIFIED: SpanKindName = "unspecified"
    INTERNAL: SpanKindName = "internal"
    SERVER: SpanKindName = "server"
    CLIENT: SpanKindName = "client"
    PRODUCER: SpanKindName = "producer"
    CONSUMER: SpanKindName = "consumer"


class SpanStatusCode:
    UNSET: int = 0
    OK: int = 1
    ERROR: int = 2


_VALID_KINDS = frozenset(
    {"unspecified", "internal", "server", "client", "producer", "consumer"}
)
_VALID_STATUS = frozenset({0, 1, 2})


def otel_meta(
    *,
    kind: SpanKindName | None = None,
    status_code: int | None = None,
    status_message: str | None = None,
    scope_name: str | None = None,
    scope_version: str | None = None,
    resource: dict[str, Any] | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build an OTel-shaped meta dict.

    All fields optional. The returned dict is mergeable into any log meta.
    """
    meta: dict[str, Any] = {"otel": True}

    if kind is not None:
        if kind not in _VALID_KINDS:
            raise ValueError(f"Invalid span_kind: {kind!r}")
        meta["span_kind"] = kind

    if status_code is not None:
        if status_code not in _VALID_STATUS:
            raise ValueError(f"Invalid span_status_code: {status_code!r}")
        meta["span_status_code"] = status_code
        if status_message is not None:
            meta["span_status_message"] = status_message

    if scope_name is not None:
        scope: dict[str, Any] = {"name": scope_name}
        if scope_version is not None:
            scope["version"] = scope_version
        meta["instrumentation_scope"] = scope

    if resource:
        meta["resource"] = dict(resource)

    if extra:
        meta.update(extra)

    return meta
