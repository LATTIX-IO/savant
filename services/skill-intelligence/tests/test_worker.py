from __future__ import annotations

import copy
import json
from pathlib import Path

from savant_skillopt_adapter import MockEngine, load_engine_pin

from savant_skill_intelligence.aggregation.dataset import curate
from savant_skill_intelligence.analysis.objective import render_objective
from savant_skill_intelligence.privacy.redaction import contains_secret, redact
from savant_skill_intelligence.worker import process_bundle

FIXTURE = Path(__file__).resolve().parents[3] / "packages" / "schemas" / "fixtures" / "optimization-job-bundle.example.json"
RESULT_KEYS = {"schemaVersion", "jobId", "leaseToken", "status"}


def load_bundle() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def test_redaction_matches_control_plane_rules() -> None:
    result = redact("token ghp_abcdefghijklmnopqrstuvwxyz0123456789 mail a@b.com password=hunter22", ["email"])
    assert "ghp_" not in result.text
    assert "a@b.com" not in result.text
    assert "password=[REDACTED:credential-assignment]" in result.text
    assert not contains_secret(result.text)


def test_curation_partitions_are_disjoint_deterministic_and_sanitized() -> None:
    bundle = load_bundle()
    first = curate(bundle["runs"], pii_classes=bundle["piiClasses"])
    second = curate(list(reversed(bundle["runs"])), pii_classes=bundle["piiClasses"])

    partitions = first.partitions()
    ids = [case.case_id for cases in partitions.values() for case in cases]
    assert len(ids) == len(set(ids)), "a task never appears in two partitions"
    assert {key: [c.case_id for c in value] for key, value in partitions.items()} == {
        key: [c.case_id for c in value] for key, value in second.partitions().items()
    }
    assert first.holdout and first.validation and first.train
    assert all(case.label == "pass" for case in first.regression), "regression set protects solved behavior"
    assert all("sk-proj-" not in case.input for cases in partitions.values() for case in cases)
    assert first.summary["received"] == 80


def test_curation_deduplicates_by_fingerprint() -> None:
    bundle = load_bundle()
    runs = bundle["runs"][:10] + copy.deepcopy(bundle["runs"][:10])
    for index, run in enumerate(runs[10:]):
        run["runId"] = f"dup-{index}"
    curated = curate(runs)
    assert curated.summary["deduplicated"] == 10
    assert curated.summary["curated"] == 10


def test_objective_uses_reason_codes_not_prose() -> None:
    statement, guidance = render_objective(load_bundle())
    assert "Insufficient detail" in statement
    assert any("overfit" in line for line in guidance)
    assert any("SAVANT:LOCKED" in line for line in guidance)


def test_process_bundle_end_to_end_with_mock_engine() -> None:
    bundle = load_bundle()
    result = process_bundle(bundle, MockEngine(), load_engine_pin())

    assert RESULT_KEYS <= set(result)
    assert result["status"] == "completed", result.get("error")
    assert "Production deployment requires sign-off." in result["candidateContent"], "locked region preserved"
    assert result["candidateContent"] != bundle["skill"]["skillMd"]
    partitions = {case["partition"] for case in result["cases"]}
    assert partitions == {"validation", "regression", "holdout"}
    validation = [case for case in result["cases"] if case["partition"] == "validation"]
    assert sum(case["candidate"] for case in validation) > sum(case["baseline"] for case in validation)
    assert result["provenance"]["engineDisplayName"] == "Microsoft SkillOpt"
    assert {entry["partition"] for entry in result["datasets"]} == {"train", "validation", "regression", "holdout"}

    holdout_ids = {case["caseId"] for case in result["cases"] if case["partition"] == "holdout"}
    train_ids = set(next(entry for entry in result["datasets"] if entry["partition"] == "train")["runIds"])
    assert holdout_ids and not (holdout_ids & train_ids), "holdout never reaches the optimizer"


def test_evaluate_only_bundles_score_the_exact_override() -> None:
    bundle = load_bundle()
    bundle["mode"] = "evaluate-only"
    bundle["candidateOverride"] = bundle["skill"]["skillMd"].replace("- Recommend one option.", "- Recommend one option and explain trade-offs and operational impact.")
    result = process_bundle(bundle, MockEngine(), load_engine_pin())
    assert result["status"] == "completed"
    assert "candidateContent" not in result
    assert result["cases"]


def test_failures_are_reported_not_raised() -> None:
    bundle = load_bundle()
    bundle["skill"]["skillMd"] = "<!-- SAVANT:LOCK broken -->\nno end"
    result = process_bundle(bundle, MockEngine(), load_engine_pin())
    assert result["status"] == "failed"
    assert "LockedRegionError" in result["error"]
