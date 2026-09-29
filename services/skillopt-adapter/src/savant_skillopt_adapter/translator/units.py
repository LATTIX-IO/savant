"""Translation between Savant's domain model and a SkillOpt optimization unit.

Savant skill packages contain SKILL.md, metadata, references, scripts, eval
assets, etc. Only SKILL.md is ever handed to the optimizer, and only with its
SAVANT:LOCK regions replaced by opaque placeholders, so the engine can neither
read nor rewrite protected content.
"""

from __future__ import annotations

import difflib
import re
from dataclasses import dataclass, field
from typing import Any, Literal

EditOp = Literal["add", "delete", "replace"]

LOCK_OPEN = re.compile(r"^\s*<!--\s*SAVANT:LOCK\s+([A-Za-z0-9._-]+)\s*-->\s*$")
LOCK_CLOSE = re.compile(r"^\s*<!--\s*SAVANT:ENDLOCK\s*-->\s*$")
PLACEHOLDER = "<!-- SAVANT:LOCKED {lock_id} (protected content omitted; do not edit or move this line) -->"
PLACEHOLDER_PATTERN = re.compile(r"^<!-- SAVANT:LOCKED ([A-Za-z0-9._-]+) \(protected content omitted; do not edit or move this line\) -->$")


class LockedRegionError(ValueError):
    """Raised when locks are malformed or a candidate tampers with a placeholder."""


@dataclass(frozen=True)
class ChangeBudget:
    aggressiveness: str
    max_changed_lines: int
    max_changed_tokens: int
    allowed_operations: tuple[EditOp, ...]
    max_iterations: int
    learning_rate: int
    permitted_sections: tuple[str, ...] | None  # None = all sections

    @classmethod
    def from_contract(cls, payload: dict[str, Any]) -> "ChangeBudget":
        sections = payload.get("permittedSections", "all")
        return cls(
            aggressiveness=str(payload.get("aggressiveness", "conservative")),
            max_changed_lines=int(payload.get("maxChangedLines", 12)),
            max_changed_tokens=int(payload.get("maxChangedTokens", 300)),
            allowed_operations=tuple(payload.get("allowedOperations", ["add", "replace"])),
            max_iterations=int(payload.get("maxIterations", 3)),
            learning_rate=int(payload.get("learningRate", 1)),
            permitted_sections=None if sections == "all" else tuple(sections),
        )


@dataclass(frozen=True)
class OptimizationCase:
    case_id: str
    input: str
    reference_output: str | None
    runtime: str | None
    label: Literal["pass", "fail"]
    failure_categories: tuple[str, ...] = ()
    rubric_failures: tuple[str, ...] = ()

    def to_task(self) -> dict[str, Any]:
        """JSONL task record handed to the engine."""
        return {
            "id": self.case_id,
            "input": self.input,
            "reference": self.reference_output,
            "label": self.label,
            "feedback": list(self.failure_categories) + [f"rubric:{dimension}" for dimension in self.rubric_failures],
        }


@dataclass(frozen=True)
class OptimizationUnit:
    skill_id: str
    base_skill_md: str
    objective: str
    budget: ChangeBudget
    train: tuple[OptimizationCase, ...]
    validation: tuple[OptimizationCase, ...]
    optimizer_backend: str
    optimizer_model: str | None
    guidance: tuple[str, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class MaskedSkill:
    masked: str
    regions: dict[str, str]


@dataclass(frozen=True)
class EditHunk:
    base_start: int
    removed: tuple[str, ...]
    added: tuple[str, ...]

    @property
    def op(self) -> EditOp:
        if not self.removed:
            return "add"
        if not self.added:
            return "delete"
        return "replace"


def normalize(text: str) -> str:
    return text.replace("\r\n", "\n")


def mask_locked_regions(skill_md: str) -> MaskedSkill:
    lines = normalize(skill_md).split("\n")
    output: list[str] = []
    regions: dict[str, str] = {}
    current_id: str | None = None
    buffer: list[str] = []

    for number, line in enumerate(lines, start=1):
        if PLACEHOLDER_PATTERN.match(line.strip()):
            raise LockedRegionError(f"Line {number} contains a reserved lock placeholder.")
        opened = LOCK_OPEN.match(line)
        if opened:
            if current_id is not None:
                raise LockedRegionError(f"Nested lock '{opened.group(1)}' at line {number}.")
            current_id = opened.group(1)
            if current_id in regions:
                raise LockedRegionError(f"Duplicate lock id '{current_id}'.")
            buffer = [line]
            continue
        if LOCK_CLOSE.match(line):
            if current_id is None:
                raise LockedRegionError(f"ENDLOCK without LOCK at line {number}.")
            buffer.append(line)
            regions[current_id] = "\n".join(buffer)
            output.append(PLACEHOLDER.format(lock_id=current_id))
            current_id = None
            buffer = []
            continue
        if current_id is not None:
            buffer.append(line)
        else:
            output.append(line)

    if current_id is not None:
        raise LockedRegionError(f"Lock '{current_id}' is never closed.")

    return MaskedSkill(masked="\n".join(output), regions=regions)


def unmask_locked_regions(candidate_masked: str, regions: dict[str, str]) -> str:
    """Restore protected content. Any moved, duplicated, altered, or missing placeholder rejects the candidate."""
    lines = normalize(candidate_masked).split("\n")
    seen: dict[str, int] = {}
    output: list[str] = []

    for line in lines:
        match = PLACEHOLDER_PATTERN.match(line.strip())
        if match:
            lock_id = match.group(1)
            if lock_id not in regions:
                raise LockedRegionError(f"Candidate references unknown lock '{lock_id}'.")
            seen[lock_id] = seen.get(lock_id, 0) + 1
            output.append(regions[lock_id])
            continue
        if "SAVANT:LOCK" in line or "SAVANT:ENDLOCK" in line or "SAVANT:LOCKED" in line:
            raise LockedRegionError("Candidate introduced or altered a lock marker.")
        output.append(line)

    for lock_id in regions:
        if seen.get(lock_id, 0) != 1:
            raise LockedRegionError(f"Locked region '{lock_id}' placeholder was removed or duplicated.")

    return "\n".join(output)


def compute_hunks(base: str, candidate: str) -> list[EditHunk]:
    a = normalize(base).split("\n")
    b = normalize(candidate).split("\n")
    matcher = difflib.SequenceMatcher(a=a, b=b, autojunk=False)
    hunks: list[EditHunk] = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            continue
        hunks.append(EditHunk(base_start=i1, removed=tuple(a[i1:i2]), added=tuple(b[j1:j2])))
    return hunks


HEADING = re.compile(r"^#{1,6}\s+(.+?)\s*#*\s*$")


def section_for_line(text: str, index: int) -> str | None:
    lines = normalize(text).split("\n")
    for cursor in range(min(index, len(lines) - 1), -1, -1):
        match = HEADING.match(lines[cursor])
        if match:
            return match.group(1)
    return None
