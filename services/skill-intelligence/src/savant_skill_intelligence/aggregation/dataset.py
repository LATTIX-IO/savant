"""Dataset curation. Production runs never become training data automatically.

    Production runs
      → privacy / policy filter
      → deduplication
      → outcome attribution
      → failure clustering (from the control plane's deterministic clusters)
      → representative sampling
      → TRAIN / VALIDATION / REGRESSION / HOLDOUT

Partitioning is by a stable hash of the task fingerprint, so the same task can
never appear in two partitions and re-curation is reproducible. HOLDOUT is
returned separately and must never be handed to the optimizer.
"""

from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Iterable

from savant_skillopt_adapter import OptimizationCase

from ..privacy.redaction import contains_secret, redact

HOLDOUT_SHARE = 0.10
VALIDATION_SHARE = 0.20
REGRESSION_MAX_SHARE = 0.15
MAX_TRAIN_CASES = 200
MAX_PER_STRATUM = 25
STRONG_POSITIVE = 0.6


@dataclass
class CuratedDataset:
    train: list[OptimizationCase]
    validation: list[OptimizationCase]
    regression: list[OptimizationCase]
    holdout: list[OptimizationCase]
    summary: dict[str, int] = field(default_factory=dict)

    def partitions(self) -> dict[str, list[OptimizationCase]]:
        return {
            "train": self.train,
            "validation": self.validation,
            "regression": self.regression,
            "holdout": self.holdout,
        }

    def summaries(self) -> list[dict[str, Any]]:
        """OptimizationDatasetSummary records for the control plane."""
        records = []
        for partition, cases in self.partitions().items():
            ids = [case.case_id for case in cases]
            records.append({
                "partition": partition,
                "caseCount": len(cases),
                "runIds": ids,
                "datasetHash": hashlib.sha256(json.dumps(sorted(ids)).encode("utf-8")).hexdigest(),
                "curationSummary": dict(self.summary),
            })
        return records


def _bucket(fingerprint: str) -> float:
    return int(hashlib.sha256(f"partition:{fingerprint}".encode("utf-8")).hexdigest()[:8], 16) / 0xFFFFFFFF


def _label(run: dict[str, Any]) -> str:
    """Outcome attribution: explicit failure signals win over optimistic success flags."""
    categories = [category for category in run.get("feedbackCategories") or [] if category != "good-result"]
    weak = run.get("weakLabel")
    if run.get("success") is False or categories or (isinstance(weak, (int, float)) and weak < 0):
        return "fail"
    return "pass"


def _is_strong_positive(run: dict[str, Any]) -> bool:
    weak = run.get("weakLabel")
    return run.get("success") is not False and isinstance(weak, (int, float)) and weak >= STRONG_POSITIVE and not run.get("feedbackCategories")


def curate(runs: Iterable[dict[str, Any]], *, pii_classes: list[str] | tuple[str, ...] = ()) -> CuratedDataset:
    summary: dict[str, int] = defaultdict(int)
    by_fingerprint: dict[str, dict[str, Any]] = {}

    for run in runs:
        summary["received"] += 1
        raw_input = run.get("input")
        if not isinstance(raw_input, str) or not raw_input.strip():
            summary["dropped_no_input"] += 1
            continue

        cleaned_input = redact(raw_input, pii_classes).text
        output = run.get("output")
        cleaned_output = redact(output, pii_classes).text if isinstance(output, str) else None
        if contains_secret(cleaned_input) or (cleaned_output and contains_secret(cleaned_output)):
            summary["dropped_secret_residue"] += 1
            continue

        fingerprint = run.get("inputFingerprint") or hashlib.sha256(" ".join(cleaned_input.lower().split()).encode("utf-8")).hexdigest()[:32]
        existing = by_fingerprint.get(fingerprint)
        if existing is not None:
            summary["deduplicated"] += 1
            # Keep the most informative duplicate: a labelled failure beats a pass.
            if _label(existing["run"]) == "pass" and _label(run) == "fail":
                by_fingerprint[fingerprint] = {"run": run, "input": cleaned_input, "output": cleaned_output}
            continue
        by_fingerprint[fingerprint] = {"run": run, "input": cleaned_input, "output": cleaned_output}

    cases: list[tuple[str, OptimizationCase, dict[str, Any]]] = []
    for fingerprint, entry in by_fingerprint.items():
        run = entry["run"]
        label = _label(run)
        cases.append((fingerprint, OptimizationCase(
            case_id=str(run["runId"]),
            input=entry["input"],
            reference_output=entry["output"] if label == "pass" else None,
            runtime=run.get("runtime"),
            label=label,  # type: ignore[arg-type]
            failure_categories=tuple(category for category in run.get("feedbackCategories") or [] if category != "good-result"),
            rubric_failures=tuple(run.get("rubricFailures") or []),
        ), run))

    train_pool: list[OptimizationCase] = []
    validation: list[OptimizationCase] = []
    regression: list[OptimizationCase] = []
    holdout: list[OptimizationCase] = []
    regression_cap = max(1, int(len(cases) * REGRESSION_MAX_SHARE))

    for fingerprint, case, run in sorted(cases, key=lambda item: item[0]):
        bucket = _bucket(fingerprint)
        if bucket < HOLDOUT_SHARE:
            holdout.append(case)
        elif bucket < HOLDOUT_SHARE + VALIDATION_SHARE:
            validation.append(case)
        elif _is_strong_positive(run) and len(regression) < regression_cap:
            # Protected regression set: behavior the current skill already gets right.
            regression.append(case)
        else:
            train_pool.append(case)

    # Representative sampling: cap each (label, category, runtime) stratum so a
    # single noisy failure mode or runtime cannot dominate training.
    strata: dict[tuple[str, str, str], list[OptimizationCase]] = defaultdict(list)
    for case in train_pool:
        key = (case.label, case.failure_categories[0] if case.failure_categories else "-", case.runtime or "-")
        strata[key].append(case)
    train: list[OptimizationCase] = []
    for key in sorted(strata):
        train.extend(strata[key][:MAX_PER_STRATUM])
    summary["sampled_out"] += max(0, len(train_pool) - len(train))
    train = train[:MAX_TRAIN_CASES]

    summary["curated"] = len(cases)
    return CuratedDataset(train=train, validation=validation, regression=regression, holdout=holdout, summary=dict(summary))
