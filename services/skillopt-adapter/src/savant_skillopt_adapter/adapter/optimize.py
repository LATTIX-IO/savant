"""Public adapter API: Savant optimization unit in, bounded candidate out.

The adapter never trusts the engine. After every optimization it:
  1. restores locked regions from placeholders (tampering rejects the candidate)
  2. derives the actual edit hunks against the base SKILL.md
  3. enforces the change budget (lines, tokens, operations, sections)

SkillOpt may analyze, reflect, suggest, and patch here. It cannot approve,
publish, or write anywhere outside the sandbox; the result is only data
returned to the Savant control plane for human review.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Sequence

from ..config.pin import EnginePin
from ..runner.engines import CaseScore, Engine
from ..sandbox.workspace import InvocationRecord, Sandbox
from ..translator.units import (
    ChangeBudget,
    EditHunk,
    LockedRegionError,
    OptimizationCase,
    OptimizationUnit,
    compute_hunks,
    mask_locked_regions,
    normalize,
    section_for_line,
    unmask_locked_regions,
)


@dataclass
class BudgetCheck:
    ok: bool
    changed_lines: int
    changed_tokens: int
    violations: list[str] = field(default_factory=list)


def verify_budget(base: str, hunks: Sequence[EditHunk], budget: ChangeBudget) -> BudgetCheck:
    changed_lines = sum(len(hunk.removed) + len(hunk.added) for hunk in hunks)
    changed_tokens = sum(len(" ".join(hunk.removed).split()) + len(" ".join(hunk.added).split()) for hunk in hunks)
    violations: list[str] = []

    if changed_lines > budget.max_changed_lines:
        violations.append(f"changes {changed_lines} lines; budget allows {budget.max_changed_lines}")
    if changed_tokens > budget.max_changed_tokens:
        violations.append(f"changes ~{changed_tokens} tokens; budget allows {budget.max_changed_tokens}")
    for hunk in hunks:
        if hunk.op not in budget.allowed_operations:
            violations.append(f"'{hunk.op}' edits are not permitted at {budget.aggressiveness} aggressiveness")
        if budget.permitted_sections is not None:
            section = section_for_line(base, hunk.base_start) or ""
            if section.lower() not in {entry.lower() for entry in budget.permitted_sections}:
                violations.append(f"edit at line {hunk.base_start + 1} touches non-permitted section '{section or '(preamble)'}'")

    return BudgetCheck(ok=not violations, changed_lines=changed_lines, changed_tokens=changed_tokens, violations=violations)


@dataclass
class AdapterResult:
    accepted: bool
    candidate: str | None
    hunks: list[EditHunk]
    rationales: list[dict[str, Any]]
    inferred_pattern: str | None
    rejection: str | None
    provenance: dict[str, Any]
    invocations: list[InvocationRecord]


SandboxFactory = Callable[[], Sandbox]


def optimize_skill(
    unit: OptimizationUnit,
    engine: Engine,
    pin: EnginePin,
    *,
    sandbox_factory: SandboxFactory | None = None,
) -> AdapterResult:
    provenance = pin.provenance(optimizer_model=unit.optimizer_model, optimizer_backend=unit.optimizer_backend)
    base = normalize(unit.base_skill_md)
    masked = mask_locked_regions(base)

    sandbox = (sandbox_factory or (lambda: Sandbox(pin.sandbox)))()
    with sandbox:
        proposal = engine.optimize(unit, masked.masked, sandbox)
        invocations = list(sandbox.invocations)

    def rejected(reason: str) -> AdapterResult:
        return AdapterResult(
            accepted=False,
            candidate=None,
            hunks=[],
            rationales=[],
            inferred_pattern=proposal.inferred_pattern,
            rejection=reason,
            provenance=provenance,
            invocations=invocations,
        )

    try:
        candidate = unmask_locked_regions(proposal.candidate_masked, masked.regions)
    except LockedRegionError as error:
        return rejected(f"Locked region violation: {error}")

    hunks = compute_hunks(base, candidate)
    if not hunks:
        return rejected("The engine did not propose any change.")

    budget = verify_budget(base, hunks, unit.budget)
    if not budget.ok:
        return rejected("Change budget exceeded: " + "; ".join(budget.violations))

    rationales: list[dict[str, Any]] = []
    for hunk in hunks:
        added = "\n".join(hunk.added)
        reason = next((text for inserted, text in proposal.rationales if inserted and inserted in added), "")
        if reason:
            rationales.append({"baseStart": hunk.base_start, "rationale": reason})

    return AdapterResult(
        accepted=True,
        candidate=candidate,
        hunks=hunks,
        rationales=rationales,
        inferred_pattern=proposal.inferred_pattern,
        rejection=None,
        provenance=provenance,
        invocations=invocations,
    )


def evaluate_skill(
    skill_md: str,
    cases: Sequence[OptimizationCase],
    engine: Engine,
    pin: EnginePin,
    *,
    backend: str,
    model: str | None,
    sandbox_factory: SandboxFactory | None = None,
) -> dict[str, CaseScore]:
    """Score a SKILL.md against cases in a fresh sandbox (never the optimizer's)."""
    if not cases:
        return {}
    sandbox = (sandbox_factory or (lambda: Sandbox(pin.sandbox)))()
    with sandbox:
        return engine.evaluate(normalize(skill_md), cases, sandbox, backend=backend, model=model)
