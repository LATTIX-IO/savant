"""Optimization engines behind a stable protocol.

`SkillOptCliEngine` drives the pinned Microsoft SkillOpt release through its
command-line interface inside the sandbox. Savant deliberately does not import
SkillOpt's internal Python object model: the file/CLI boundary survives
upstream refactors of an alpha project.

`MockEngine` is deterministic and makes no provider calls. It mirrors
SkillOpt's own `mock` backend so the full Savant loop can be exercised in tests
and local development without API spend.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from typing import Any, Protocol, Sequence

from ..config.pin import EnginePin
from ..sandbox.workspace import Sandbox, SandboxError
from ..translator.units import OptimizationCase, OptimizationUnit, normalize


@dataclass(frozen=True)
class EngineProposal:
    """Candidate SKILL.md with lock placeholders still in place."""

    candidate_masked: str
    rationales: tuple[tuple[str, str], ...] = ()  # (inserted text, rationale)
    inferred_pattern: str | None = None


@dataclass(frozen=True)
class CaseScore:
    overall: float
    dimensions: dict[str, float] = field(default_factory=dict)
    latency_ms: float | None = None
    cost: float | None = None


class Engine(Protocol):
    name: str

    def optimize(self, unit: OptimizationUnit, masked_skill: str, sandbox: Sandbox) -> EngineProposal: ...

    def evaluate(
        self,
        skill_md: str,
        cases: Sequence[OptimizationCase],
        sandbox: Sandbox,
        *,
        backend: str,
        model: str | None,
    ) -> dict[str, CaseScore]: ...


# ---------------------------------------------------------------------------
# Mock engine
# ---------------------------------------------------------------------------

GUIDANCE: dict[str, tuple[str, str]] = {
    # category -> (instruction, keyword the evaluator looks for)
    "insufficient-detail": ("- Provide concrete supporting detail for every recommendation, including trade-offs and operational impact.", "trade-offs and operational impact"),
    "missing-knowledge": ("- State the domain facts the answer depends on and flag any that could not be verified.", "domain facts the answer depends on"),
    "incorrect-procedure": ("- Follow the documented procedure step by step and say explicitly when a step is skipped.", "procedure step by step"),
    "too-verbose": ("- Lead with the conclusion and keep supporting sections brief.", "lead with the conclusion"),
    "obsolete-information": ("- Prefer the most recent approved sources and note the date of any cited policy.", "most recent approved sources"),
    "format-failure": ("- Match the required output format exactly, including headings and field order.", "required output format exactly"),
    "tool-use-failure": ("- Confirm tool results before relying on them and report tool errors instead of guessing.", "confirm tool results"),
    "unsafe-recommendation": ("- Escalate to a human reviewer before recommending any irreversible or high-risk action.", "escalate to a human reviewer"),
    "should-have-done": ("- Before finishing, check the request for any explicitly requested step that has not been completed.", "explicitly requested step"),
    "bad-result": ("- Re-read the request and verify the answer addresses its actual goal before responding.", "addresses its actual goal"),
}


def _rubric_guidance(dimension: str) -> tuple[str, str]:
    return (f"- Explicitly address {dimension} for every option you evaluate.", f"address {dimension.lower()}")


def _stable_fraction(value: str) -> float:
    return int(hashlib.sha256(value.encode("utf-8")).hexdigest()[:8], 16) / 0xFFFFFFFF


HEADING = re.compile(r"^#{1,6}\s+(.+?)\s*#*\s*$")
# Descriptive sections that should never receive behavioral instructions.
NON_INSTRUCTION_SECTIONS = frozenset({"metadata", "references", "changelog", "examples"})


def _insertion_index(lines: list[str], permitted: tuple[str, ...] | None) -> int:
    """After the last bullet of the first permitted section that has a bullet list."""
    permitted_lower = {section.lower() for section in permitted} if permitted else None
    current: str | None = None
    best: int | None = None
    for index, line in enumerate(lines):
        heading = HEADING.match(line)
        if heading:
            if best is not None:
                return best
            current = heading.group(1)
            continue
        if "SAVANT:LOCKED" in line:
            if best is not None:
                return best
            current = None
            continue
        allowed = (
            current is not None
            and current.lower() not in NON_INSTRUCTION_SECTIONS
            and (permitted_lower is None or current.lower() in permitted_lower)
        )
        if allowed and line.lstrip().startswith(("- ", "* ")):
            best = index + 1
    if best is not None:
        return best
    return len(lines)


class MockEngine:
    name = "mock"

    def optimize(self, unit: OptimizationUnit, masked_skill: str, sandbox: Sandbox) -> EngineProposal:
        del sandbox
        counts: dict[str, int] = {}
        for case in unit.train:
            if case.label != "fail":
                continue
            for category in case.failure_categories:
                if category in GUIDANCE:
                    counts[f"category:{category}"] = counts.get(f"category:{category}", 0) + 1
            for dimension in case.rubric_failures:
                counts[f"rubric:{dimension}"] = counts.get(f"rubric:{dimension}", 0) + 1

        lower = masked_skill.lower()
        ranked = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
        budget_lines = min(unit.budget.max_changed_lines, unit.budget.learning_rate * unit.budget.max_iterations)
        additions: list[tuple[str, str]] = []
        for key, count in ranked:
            if len(additions) >= budget_lines:
                break
            kind, value = key.split(":", 1)
            instruction, keyword = GUIDANCE[value] if kind == "category" else _rubric_guidance(value)
            if keyword.lower() in lower:
                continue
            additions.append((instruction, f"{count} training case(s) failed with '{value}'."))

        if not additions or "add" not in unit.budget.allowed_operations:
            return EngineProposal(candidate_masked=masked_skill, inferred_pattern=None)

        lines = normalize(masked_skill).split("\n")
        index = _insertion_index(lines, unit.budget.permitted_sections)
        lines[index:index] = [instruction for instruction, _ in additions]
        top = ranked[0][0].split(":", 1)[1]
        return EngineProposal(
            candidate_masked="\n".join(lines),
            rationales=tuple(additions),
            inferred_pattern=f"Existing instructions do not direct the model to handle '{top}', the most frequent failure in training rollouts.",
        )

    def evaluate(
        self,
        skill_md: str,
        cases: Sequence[OptimizationCase],
        sandbox: Sandbox,
        *,
        backend: str,
        model: str | None,
    ) -> dict[str, CaseScore]:
        del sandbox, backend, model
        lower = skill_md.lower()
        scores: dict[str, CaseScore] = {}
        for case in cases:
            score = 70 + 18 * _stable_fraction(case.case_id) + (8 if case.label == "pass" else 0)
            completeness = score + 2
            for category in case.failure_categories:
                keyword = GUIDANCE.get(category, (None, None))[1]
                if keyword and keyword.lower() in lower:
                    score += 7
                    completeness += 9
            for dimension in case.rubric_failures:
                if _rubric_guidance(dimension)[1] in lower:
                    score += 6
                    completeness += 8
            scores[case.case_id] = CaseScore(
                overall=round(min(100.0, score), 2),
                dimensions={
                    "security-compliance": 100.0,
                    "format-compliance": 97.0,
                    "completeness": round(min(100.0, completeness), 2),
                },
                latency_ms=round(900 + len(skill_md) / 8, 1),
                cost=round(0.004 + len(skill_md) / 1_000_000, 6),
            )
        return scores


# ---------------------------------------------------------------------------
# Pinned SkillOpt CLI engine
# ---------------------------------------------------------------------------


class SkillOptCliEngine:
    """Runs the pinned SkillOpt release via its CLI inside the sandbox."""

    name = "skillopt"

    def __init__(self, pin: EnginePin, *, endpoint: str | None = None) -> None:
        if "optimize" not in pin.commands or "evaluate" not in pin.commands:
            raise ValueError("skillopt.lock.toml must define [commands] optimize and evaluate templates.")
        self.pin = pin
        self.endpoint = endpoint

    def _render(self, template: Sequence[str], values: dict[str, Any]) -> list[str]:
        rendered: list[str] = []
        for part in template:
            try:
                rendered.append(part.format(**values))
            except KeyError as missing:
                raise ValueError(f"Unknown placeholder in SkillOpt command template: {missing}") from missing
        return rendered

    def optimize(self, unit: OptimizationUnit, masked_skill: str, sandbox: Sandbox) -> EngineProposal:
        sandbox.assert_egress_allowed(self.endpoint)
        skill_path = sandbox.path("skill/SKILL.md")
        skill_path.write_text(masked_skill, encoding="utf-8")
        train_path = sandbox.path("tasks/train.jsonl")
        val_path = sandbox.path("tasks/val.jsonl")
        train_path.write_text("\n".join(json.dumps(case.to_task()) for case in unit.train), encoding="utf-8")
        val_path.write_text("\n".join(json.dumps(case.to_task()) for case in unit.validation), encoding="utf-8")
        sandbox.path("objective.md").write_text(
            "\n".join([unit.objective, "", *unit.guidance]),
            encoding="utf-8",
        )
        output_dir = sandbox.path("out/.keep").parent

        record = sandbox.run(self._render(self.pin.commands["optimize"], {
            "skill_path": skill_path,
            "train_path": train_path,
            "val_path": val_path,
            "backend": unit.optimizer_backend,
            "model": unit.optimizer_model or self.pin.default_model,
            "max_iterations": unit.budget.max_iterations,
            "learning_rate": unit.budget.learning_rate,
            "output_dir": output_dir,
        }))
        if record.exit_code != 0:
            raise SandboxError(f"SkillOpt optimize exited with {record.exit_code}: {record.stderr_tail[-500:]}")

        candidate_path = output_dir / "SKILL.md"
        if not candidate_path.exists():
            return EngineProposal(candidate_masked=masked_skill)

        report_path = output_dir / "report.json"
        report: dict[str, Any] = {}
        if report_path.exists():
            try:
                report = json.loads(report_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                report = {}

        rationales = tuple(
            (str(entry.get("text", "")), str(entry.get("rationale", "")))
            for entry in report.get("edits", [])
            if isinstance(entry, dict)
        )
        return EngineProposal(
            candidate_masked=candidate_path.read_text(encoding="utf-8"),
            rationales=rationales,
            inferred_pattern=report.get("reflection") if isinstance(report.get("reflection"), str) else None,
        )

    def evaluate(
        self,
        skill_md: str,
        cases: Sequence[OptimizationCase],
        sandbox: Sandbox,
        *,
        backend: str,
        model: str | None,
    ) -> dict[str, CaseScore]:
        sandbox.assert_egress_allowed(self.endpoint)
        skill_path = sandbox.path("eval/SKILL.md")
        skill_path.write_text(skill_md, encoding="utf-8")
        cases_path = sandbox.path("eval/cases.jsonl")
        cases_path.write_text("\n".join(json.dumps(case.to_task()) for case in cases), encoding="utf-8")
        scores_path = sandbox.path("eval/scores.json")

        record = sandbox.run(self._render(self.pin.commands["evaluate"], {
            "skill_path": skill_path,
            "cases_path": cases_path,
            "backend": backend,
            "model": model or self.pin.default_model,
            "scores_path": scores_path,
        }))
        if record.exit_code != 0 or not scores_path.exists():
            raise SandboxError(f"SkillOpt evaluate failed with {record.exit_code}: {record.stderr_tail[-500:]}")

        raw = json.loads(scores_path.read_text(encoding="utf-8"))
        scores: dict[str, CaseScore] = {}
        for case_id, entry in raw.items():
            if isinstance(entry, (int, float)):
                scores[str(case_id)] = CaseScore(overall=float(entry))
            elif isinstance(entry, dict) and isinstance(entry.get("overall"), (int, float)):
                scores[str(case_id)] = CaseScore(
                    overall=float(entry["overall"]),
                    dimensions={key: float(value) for key, value in (entry.get("dimensions") or {}).items()},
                    latency_ms=entry.get("latencyMs"),
                    cost=entry.get("cost"),
                )
        return scores


def create_engine(name: str, pin: EnginePin, *, endpoint: str | None = None) -> Engine:
    if name == "mock":
        return MockEngine()
    if name == "skillopt":
        return SkillOptCliEngine(pin, endpoint=endpoint)
    raise ValueError(f"Unknown optimization engine '{name}'.")
