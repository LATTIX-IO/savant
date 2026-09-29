"""Held-out validation, protected regression, and shadow holdout evaluation.

Baseline and candidate are scored on the same cases in fresh sandboxes. The
worker returns raw paired case results; the control plane recomputes the gate,
the bootstrap interval, and the evidence strength itself, so nothing here is a
trusted verdict. `local_gate_summary` exists only for worker logs.
"""

from __future__ import annotations

from typing import Any, Sequence

from savant_skillopt_adapter import Engine, EnginePin, OptimizationCase, evaluate_skill


def paired_case_results(
    *,
    baseline_md: str,
    candidate_md: str,
    partitions: dict[str, Sequence[OptimizationCase]],
    engine: Engine,
    pin: EnginePin,
    backend: str,
    model: str | None,
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for partition in ("validation", "regression", "holdout"):
        cases = list(partitions.get(partition) or [])
        if not cases:
            continue
        baseline = evaluate_skill(baseline_md, cases, engine, pin, backend=backend, model=model)
        candidate = evaluate_skill(candidate_md, cases, engine, pin, backend=backend, model=model)
        for case in cases:
            before = baseline.get(case.case_id)
            after = candidate.get(case.case_id)
            if before is None or after is None:
                continue
            record: dict[str, Any] = {
                "caseId": case.case_id,
                "partition": partition,
                "baseline": before.overall,
                "candidate": after.overall,
            }
            if case.runtime:
                record["runtime"] = case.runtime
            shared = sorted(set(before.dimensions) & set(after.dimensions))
            if shared:
                record["dimensions"] = {
                    dimension: {"baseline": before.dimensions[dimension], "candidate": after.dimensions[dimension]}
                    for dimension in shared
                }
            if before.latency_ms is not None and after.latency_ms is not None:
                record["baselineLatencyMs"] = before.latency_ms
                record["candidateLatencyMs"] = after.latency_ms
            if before.cost is not None and after.cost is not None:
                record["baselineCost"] = before.cost
                record["candidateCost"] = after.cost
            results.append(record)
    return results


def local_gate_summary(results: Sequence[dict[str, Any]]) -> dict[str, Any]:
    def mean(values: list[float]) -> float | None:
        return sum(values) / len(values) if values else None

    summary: dict[str, Any] = {}
    for partition in ("validation", "regression", "holdout"):
        rows = [row for row in results if row["partition"] == partition]
        summary[partition] = {
            "cases": len(rows),
            "baseline": mean([row["baseline"] for row in rows]),
            "candidate": mean([row["candidate"] for row in rows]),
        }
    return summary
