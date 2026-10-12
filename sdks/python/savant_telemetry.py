"""Reference Savant v1 opt-in no-content telemetry sender.

This SDK does not call models, execute harness tasks or hold Savant credentials.
Applications supply an authenticated, scoped transport; production receipt
verification and storage belong to the Savant control plane (PER-1059).
"""
from __future__ import annotations

import math
import re
from collections import deque
from typing import Any, Callable

_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_DIGEST = re.compile(r"^[a-f0-9]{64}$")
_ALLOWED = frozenset({
    "schemaVersion", "tenantId", "adapterId", "runId", "traceId", "spanId",
    "parentSpanId", "nodeId", "specVersionHash", "testSuiteHash", "kind", "status",
    "startedAtMs", "durationMs", "inputTokens", "outputTokens", "estimatedCostUsd",
    "captureLevel",
})
_REQUIRED = _ALLOWED - {
    "parentSpanId", "nodeId", "durationMs", "inputTokens", "outputTokens", "estimatedCostUsd"
}


class TelemetryError(Exception):
    """Deliberately contains only a safe code, never user-controlled content."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def _fail(code: str = "invalid_telemetry") -> None:
    raise TelemetryError(code)


def _id(value: Any) -> bool:
    return type(value) is str and bool(_IDENTIFIER.fullmatch(value))


def _nonnegative(value: Any, max_value: int | float, integer: bool = False) -> bool:
    if integer:
        return type(value) is int and 0 <= value <= max_value
    return type(value) in (int, float) and math.isfinite(value) and 0 <= value <= max_value


def validate_span(raw: Any) -> dict[str, Any]:
    """Whitelists only structured evidence, denying prompt/response/secret fields."""
    if type(raw) is not dict or set(raw) - _ALLOWED or _REQUIRED - set(raw):
        _fail()
    for key in ("tenantId", "adapterId", "runId", "traceId", "spanId"):
        if not _id(raw[key]):
            _fail()
    if type(raw["schemaVersion"]) is not int or raw["schemaVersion"] != 1:
        _fail()
    if type(raw["specVersionHash"]) is not str or not _DIGEST.fullmatch(raw["specVersionHash"]):
        _fail()
    if type(raw["testSuiteHash"]) is not str or not _DIGEST.fullmatch(raw["testSuiteHash"]):
        _fail()
    if raw["kind"] not in ("workflow", "step", "tool", "model"):
        _fail()
    if raw["status"] not in ("started", "completed", "failed", "canceled"):
        _fail()
    if raw["captureLevel"] not in ("none", "metadata"):
        _fail()
    if not _nonnegative(raw["startedAtMs"], 2**53 - 1, integer=True):
        _fail()
    if "parentSpanId" in raw and (not _id(raw["parentSpanId"]) or raw["parentSpanId"] == raw["spanId"]):
        _fail()
    if "nodeId" in raw and not _id(raw["nodeId"]):
        _fail()
    for key in ("durationMs", "inputTokens", "outputTokens"):
        if key in raw and not _nonnegative(raw[key], 1_000_000_000, integer=True):
            _fail()
    if "estimatedCostUsd" in raw and not _nonnegative(raw["estimatedCostUsd"], 100_000):
        _fail()
    return dict(raw)


class TelemetryBuffer:
    """Fail-closed, process-local lossless queue with bounded accepted backlog.

    send(batch) must return {"batchId": ..., "acceptedCursor": ...}, and the
    receiver must atomically dedupe batchId per tenant. Disconnects preserve
    the identical batch receipt identity for retry.
    """

    def __init__(
        self,
        *,
        enabled: bool = False,
        tenant_id: str,
        adapter_id: str,
        trace_id: str,
        send: Callable[[dict[str, Any]], dict[str, Any]],
        max_pending: int = 256,
        batch_size: int = 100,
    ):
        if not all(_id(v) for v in (tenant_id, adapter_id, trace_id)):
            _fail("invalid_configuration")
        if not callable(send) or type(enabled) is not bool:
            _fail("invalid_configuration")
        if type(max_pending) is not int or not 1 <= max_pending <= 1000:
            _fail("invalid_configuration")
        if type(batch_size) is not int or not 1 <= batch_size <= 100:
            _fail("invalid_configuration")
        self.enabled, self.tenant_id, self.adapter_id, self.trace_id = (
            enabled, tenant_id, adapter_id, trace_id
        )
        self._send = send
        self.max_pending, self.batch_size = max_pending, batch_size
        self._queue: deque[dict[str, Any]] = deque()
        self._seen: dict[str, tuple[Any, ...]] = {}
        self._cursor = 0

    def record(self, raw: Any) -> bool:
        if not self.enabled:
            return False
        item = validate_span(raw)
        if (item["tenantId"], item["adapterId"], item["traceId"]) != (
            self.tenant_id, self.adapter_id, self.trace_id
        ):
            _fail("identity_mismatch")
        key = ":".join((item["runId"], item["spanId"], item["status"]))
        identity = tuple(sorted(item.items()))
        if key in self._seen:
            if self._seen[key] != identity:
                _fail("replay_conflict")
            return False
        if len(self._queue) >= self.max_pending:
            _fail("backpressure")
        if len(self._seen) >= 2048:
            del self._seen[next(iter(self._seen))]
        self._seen[key] = identity
        self._queue.append(item)
        return True

    def pending_count(self) -> int:
        return len(self._queue)

    def flush(self) -> int:
        if not self.enabled or not self._queue:
            return 0
        spans = list(self._queue)[:self.batch_size]
        batch_id = (
            f"b:{self.trace_id}:{self._cursor}:{spans[0]['spanId']}:{spans[-1]['spanId']}"
        )
        batch = {
            "schemaVersion": 1,
            "tenantId": self.tenant_id,
            "adapterId": self.adapter_id,
            "traceId": self.trace_id,
            "batchId": batch_id,
            "cursor": self._cursor,
            "spans": spans,
        }
        try:
            acknowledgement = self._send(batch)
        except Exception:
            _fail("transport_unavailable")
        if (type(acknowledgement) is not dict or
            acknowledgement.get("batchId") != batch_id or
            type(acknowledgement.get("acceptedCursor")) is not int or
            acknowledgement["acceptedCursor"] != self._cursor + len(spans)):
            _fail("invalid_ack")
        for _ in spans:
            self._queue.popleft()
        self._cursor += len(spans)
        return len(spans)


def summarize_coverage(expected: list[str], spans: list[dict[str, Any]]) -> dict[str, Any]:
    if any(not _id(step) for step in expected):
        _fail()
    expected_ids = set(expected)
    observed: set[str] = set()
    attribution = None
    for source in spans:
        parsed = validate_span(source)
        identity = tuple(parsed[key] for key in (
            "tenantId", "adapterId", "runId", "traceId",
            "specVersionHash", "testSuiteHash"
        ))
        if attribution is not None and attribution != identity:
            _fail("identity_mismatch")
        attribution = identity
        if parsed["kind"] == "step" and parsed.get("nodeId") in expected_ids:
            observed.add(parsed["nodeId"])
    missing = sorted(expected_ids - observed)
    return {
        "completeness": ("none" if not observed else "partial" if missing else "complete"),
        "observedStepIds": sorted(observed),
        "missingStepIds": missing,
    }
