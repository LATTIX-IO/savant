"""Explicit, multi-dimensional optimization objectives.

"Improve this skill" is never an objective. The control plane sends a
structured objective (primary dimensions + guardrails); this module renders it,
plus structured reviewer rejection signals, into guidance for the engine.
Reviewer rejection *prose* never reaches the optimizer — only reason codes.
"""

from __future__ import annotations

from typing import Any

REJECTION_GUIDANCE = {
    "overfit": "Prefer general instructions over rules tailored to individual examples.",
    "style-regression": "Preserve the skill's existing voice, structure, and formatting conventions.",
    "unnecessary-complexity": "Prefer the smallest edit that addresses the failure pattern.",
    "duplicate-instruction": "Do not restate instructions that already exist in the skill.",
    "security-concern": "Do not weaken, reword, or add exceptions to safety or approval requirements.",
    "violates-organizational-method": "Stay within the organization's documented method; do not introduce new procedures.",
    "good-idea-wrong-wording": "Keep wording precise and consistent with the surrounding instructions.",
    "insufficient-evidence": "Only address failure patterns supported by multiple independent runs.",
    "recommendation-incorrect": "Verify that each proposed instruction directly addresses an observed failure.",
}


def render_objective(bundle: dict[str, Any]) -> tuple[str, tuple[str, ...]]:
    objective = bundle.get("objective") or {}
    statement = str(objective.get("statement") or "Increase task success without regressing guardrail dimensions.")

    guidance: list[str] = []
    for guardrail in objective.get("guardrails") or []:
        guidance.append(f"Guardrail: {guardrail.get('dimension')} must be {guardrail.get('constraint')}.")
    for cluster in (bundle.get("clusters") or [])[:5]:
        if cluster.get("clusterId") == "uncategorized":
            continue
        guidance.append(f"Observed failure cluster: {cluster.get('label')} ({cluster.get('runCount')} runs, {cluster.get('share')}% of failures).")
    for signal in bundle.get("rejectionSignals") or []:
        hint = REJECTION_GUIDANCE.get(signal.get("reason"))
        if hint:
            guidance.append(f"Prior reviewers rejected candidates as '{signal.get('reason')}' ({signal.get('count')}x): {hint}")
    guidance.append("Only SKILL.md may change. Lines marked SAVANT:LOCKED must remain exactly as they are, in place.")
    return statement, tuple(guidance)
