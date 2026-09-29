"""Pipeline for one optimization job.

    bundle (sanitized, from control plane)
      → curate datasets (train / validation / regression / holdout)
      → SkillOpt candidate generation on TRAIN + VALIDATION only (sandboxed)
      → baseline vs candidate on VALIDATION, REGRESSION, and HOLDOUT
      → OptimizationJobResult (raw paired results + provenance) → control plane

For MVP these stages run as modules in one worker process; the boundaries
(aggregation / optimization / validation / recommendation) are kept clean
enough to split into separate services later.
"""

from __future__ import annotations

import logging
import time
from typing import Any

from savant_skillopt_adapter import (
    ChangeBudget,
    Engine,
    EnginePin,
    LockedRegionError,
    OptimizationUnit,
    SandboxError,
    optimize_skill,
)

from .aggregation.dataset import curate
from .analysis.objective import render_objective
from .ingestion.control_plane import ControlPlaneClient, ControlPlaneError
from .validation.evaluate import local_gate_summary, paired_case_results

log = logging.getLogger("savant.skill_intelligence")


def process_bundle(bundle: dict[str, Any], engine: Engine, pin: EnginePin) -> dict[str, Any]:
    """Turn a claimed job bundle into an OptimizationJobResult payload."""
    base_result: dict[str, Any] = {
        "schemaVersion": 1,
        "jobId": bundle["jobId"],
        "leaseToken": bundle["leaseToken"],
    }

    try:
        skill = bundle["skill"]
        base_md: str = skill["skillMd"]
        optimizer = bundle.get("optimizer") or {}
        backend = str(optimizer.get("provider") or pin.default_backend)
        model = optimizer.get("model")
        provenance = pin.provenance(optimizer_model=model, optimizer_backend=backend)
        dataset = curate(bundle.get("runs") or [], pii_classes=tuple(bundle.get("piiClasses") or ()))

        rationales: list[dict[str, Any]] = []
        inferred_pattern: str | None = None

        if bundle.get("mode") == "evaluate-only":
            candidate_md = bundle.get("candidateOverride")
            if not isinstance(candidate_md, str) or not candidate_md.strip():
                raise ValueError("evaluate-only bundle is missing candidateOverride")
        else:
            if not dataset.train:
                raise ValueError("No curatable training cases after privacy filtering and deduplication.")
            statement, guidance = render_objective(bundle)
            unit = OptimizationUnit(
                skill_id=skill["skillId"],
                base_skill_md=base_md,
                objective=statement,
                budget=ChangeBudget.from_contract(bundle.get("changeBudget") or {}),
                train=tuple(dataset.train),
                validation=tuple(dataset.validation),  # holdout deliberately excluded
                optimizer_backend=backend,
                optimizer_model=model,
                guidance=guidance,
            )
            adapted = optimize_skill(unit, engine, pin)
            for invocation in adapted.invocations:
                log.info("engine invocation exit=%s duration_ms=%s", invocation.exit_code, invocation.duration_ms)
            if not adapted.accepted or adapted.candidate is None:
                log.info("job %s produced no acceptable candidate: %s", bundle["jobId"], adapted.rejection)
                # Returning the base content tells the control plane "no improvement".
                return {**base_result, "status": "completed", "candidateContent": base_md, "cases": [], "datasets": dataset.summaries(), "provenance": provenance, "inferredPattern": adapted.rejection}
            candidate_md = adapted.candidate
            rationales = adapted.rationales
            inferred_pattern = adapted.inferred_pattern

        cases = paired_case_results(
            baseline_md=base_md,
            candidate_md=candidate_md,
            partitions={"validation": dataset.validation, "regression": dataset.regression, "holdout": dataset.holdout},
            engine=engine,
            pin=pin,
            backend=backend,
            model=model,
        )
        log.info("job %s local gate summary: %s", bundle["jobId"], local_gate_summary(cases))

        result: dict[str, Any] = {
            **base_result,
            "status": "completed",
            "cases": cases,
            "datasets": dataset.summaries(),
            "provenance": provenance,
            "dependentSuites": [],
        }
        if bundle.get("mode") != "evaluate-only":
            result["candidateContent"] = candidate_md
            result["editRationales"] = rationales
            if inferred_pattern:
                result["inferredPattern"] = inferred_pattern
        return result
    except (SandboxError, LockedRegionError, ValueError, KeyError) as error:
        log.warning("job %s failed: %s", bundle.get("jobId"), error)
        return {**base_result, "status": "failed", "error": f"{type(error).__name__}: {error}"[:1000]}


def run_once(client: ControlPlaneClient, engine: Engine, pin: EnginePin) -> bool:
    """Claim and process one job. Returns False when the queue is empty."""
    bundle = client.claim()
    if not bundle:
        return False
    log.info("claimed job %s for skill %s (%s)", bundle["jobId"], bundle["skill"]["skillId"], bundle.get("mode"))
    result = process_bundle(bundle, engine, pin)
    outcome = client.submit(bundle["jobId"], result)
    log.info("submitted job %s: %s", bundle["jobId"], outcome)
    return True


def run_forever(client: ControlPlaneClient, engine: Engine, pin: EnginePin, *, poll_seconds: float = 30.0) -> None:
    while True:
        try:
            if run_once(client, engine, pin):
                continue
        except ControlPlaneError as error:
            log.error("control plane error: %s", error)
        time.sleep(poll_seconds)
