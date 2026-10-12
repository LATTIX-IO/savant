import unittest

from savant_telemetry import (
    TelemetryBuffer,
    TelemetryError,
    summarize_coverage,
    validate_span,
)

HASH_A = "a" * 64
HASH_B = "b" * 64


def make_span(span_id="s1", **fields):
    return {
        "schemaVersion": 1, "tenantId": "tenant-a", "adapterId": "adapter-a",
        "runId": "run-a", "traceId": "trace-a", "spanId": span_id,
        "specVersionHash": HASH_A, "testSuiteHash": HASH_B,
        "kind": "step", "status": "completed", "startedAtMs": 10,
        "durationMs": 20, "captureLevel": "metadata",
        **fields,
    }


def buffered(send, **kwargs):
    return TelemetryBuffer(
        enabled=True, tenant_id="tenant-a", adapter_id="adapter-a",
        trace_id="trace-a", send=send, **kwargs
    )


class TelemetryContractTests(unittest.TestCase):
    def test_valid_span_is_copy_and_unknown_raw_content_forbidden(self):
        original = make_span()
        owned = validate_span(original)
        original["runId"] = "mutated"
        self.assertEqual(owned["runId"], "run-a")
        for bad in (
            make_span(input="sensitive token"),
            make_span(prompt="secret"),
            make_span(schemaVersion=2),
            make_span(captureLevel="full"),
            make_span(specVersionHash="short"),
            make_span(startedAtMs=-1),
            make_span(nodeId="../../traversal"),
            make_span(inputTokens=-10),
            {**make_span(), "__proto__": {"admin": True}},
        ):
            with self.subTest(bad=bad):
                with self.assertRaises(TelemetryError):
                    validate_span(bad)

    def test_disabled_sends_nothing_even_invalid_payload(self):
        calls = []
        sdk = TelemetryBuffer(
            enabled=False, tenant_id="tenant-a", adapter_id="adapter-a",
            trace_id="trace-a", send=lambda b: calls.append(b)
        )
        self.assertFalse(sdk.record({"some": "raw content"}))
        self.assertEqual(sdk.flush(), 0)
        self.assertEqual(calls, [])

    def test_duplicate_and_replay_cursor(self):
        records = []
        def send(batch):
            records.append(batch)
            return {
                "batchId": batch["batchId"],
                "acceptedCursor": batch["cursor"] + len(batch["spans"]),
            }
        sdk = buffered(send)
        self.assertTrue(sdk.record(make_span()))
        self.assertFalse(sdk.record(make_span()))
        with self.assertRaisesRegex(TelemetryError, "^replay_conflict$"):
            sdk.record(make_span(testSuiteHash=HASH_A))
        sdk.record(make_span("s2"))
        self.assertEqual(sdk.flush(), 2)
        self.assertEqual(sdk.flush(), 0)
        self.assertEqual(sdk.pending_count(), 0)
        self.assertEqual([[s["spanId"] for s in b["spans"]] for b in records], [["s1", "s2"]])

    def test_transport_fails_redacted_and_retries_same_batch(self):
        seen = []
        def send(batch):
            seen.append(batch["batchId"])
            if len(seen) == 1:
                raise RuntimeError("provider private credential")
            return {"batchId": batch["batchId"], "acceptedCursor": batch["cursor"] + 1}
        sdk = buffered(send)
        sdk.record(make_span())
        with self.assertRaisesRegex(TelemetryError, "^transport_unavailable$"):
            sdk.flush()
        self.assertEqual(sdk.pending_count(), 1)
        self.assertEqual(sdk.flush(), 1)
        self.assertEqual(seen[0], seen[1])

    def test_spoofed_receipt_and_cross_tenant_deny(self):
        sdk = buffered(lambda batch: {"batchId": "forged", "acceptedCursor": 100})
        with self.assertRaisesRegex(TelemetryError, "^identity_mismatch$"):
            sdk.record(make_span(tenantId="foreign"))
        self.assertEqual(sdk.pending_count(), 0)
        sdk.record(make_span())
        with self.assertRaisesRegex(TelemetryError, "^invalid_ack$"):
            sdk.flush()
        self.assertEqual(sdk.pending_count(), 1)

    def test_backpressure_preserves_unsent_events(self):
        sdk = buffered(lambda _: {}, max_pending=1)
        sdk.record(make_span())
        with self.assertRaisesRegex(TelemetryError, "^backpressure$"):
            sdk.record(make_span("s2"))
        self.assertEqual(sdk.pending_count(), 1)

    def test_graph_coverage_rejects_mixed_tenant_run_and_version(self):
        changes = (
            {"tenantId": "foreign"}, {"adapterId": "other"},
            {"runId": "different"}, {"traceId": "different"},
            {"specVersionHash": HASH_B}, {"testSuiteHash": HASH_A},
        )
        for mutation in changes:
            with self.subTest(mutation=mutation):
                with self.assertRaisesRegex(TelemetryError, "^identity_mismatch$"):
                    summarize_coverage(
                        ["step-a", "step-b"],
                        [make_span("one", nodeId="step-a"),
                         make_span("two", nodeId="step-b", **mutation)]
                    )

    def test_graph_coverage_is_partial_when_step_missing(self):
        self.assertEqual(summarize_coverage(
            ["step-a", "step-b"], [make_span(nodeId="step-a")]
        ), {
            "completeness": "partial",
            "observedStepIds": ["step-a"],
            "missingStepIds": ["step-b"],
        })
        self.assertEqual(summarize_coverage(["step-a"], []), {
            "completeness": "none",
            "observedStepIds": [],
            "missingStepIds": ["step-a"],
        })


if __name__ == "__main__":
    unittest.main()
