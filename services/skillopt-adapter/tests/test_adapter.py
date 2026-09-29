from __future__ import annotations

import sys

import pytest

from savant_skillopt_adapter import (
    ChangeBudget,
    LockedRegionError,
    MockEngine,
    OptimizationCase,
    OptimizationUnit,
    Sandbox,
    SandboxError,
    evaluate_skill,
    load_engine_pin,
    mask_locked_regions,
    optimize_skill,
    unmask_locked_regions,
)
from savant_skillopt_adapter.config.pin import SandboxPolicy
from savant_skillopt_adapter.runner.engines import EngineProposal

SKILL = "\n".join([
    "# Technical Design Memo",
    "",
    "## Procedure",
    "- Compare architecture alternatives.",
    "- Recommend one option.",
    "",
    "<!-- SAVANT:LOCK security-policy -->",
    "## Mandatory Human Approval",
    "Production deployment requires sign-off.",
    "<!-- SAVANT:ENDLOCK -->",
])

CONSERVATIVE = ChangeBudget(
    aggressiveness="conservative",
    max_changed_lines=12,
    max_changed_tokens=300,
    allowed_operations=("add", "replace"),
    max_iterations=3,
    learning_rate=1,
    permitted_sections=None,
)


def case(case_id: str, label: str = "fail", categories: tuple[str, ...] = ("insufficient-detail",)) -> OptimizationCase:
    return OptimizationCase(case_id=case_id, input=f"task {case_id}", reference_output=None, runtime="openai", label=label, failure_categories=categories if label == "fail" else ())


def unit(budget: ChangeBudget = CONSERVATIVE) -> OptimizationUnit:
    return OptimizationUnit(
        skill_id="technical-design-memo",
        base_skill_md=SKILL,
        objective="Reduce insufficient-detail failures.",
        budget=budget,
        train=tuple(case(f"t{index}") for index in range(6)),
        validation=tuple(case(f"v{index}") for index in range(4)),
        optimizer_backend="azure-openai",
        optimizer_model=None,
    )


def test_pin_loads_and_hashes_deterministically() -> None:
    pin = load_engine_pin()
    assert pin.version == "0.2.0"
    assert pin.config_hash == load_engine_pin().config_hash
    provenance = pin.provenance(optimizer_model="m", optimizer_backend="azure-openai")
    assert provenance["engineDisplayName"] == "Microsoft SkillOpt"
    assert provenance["configHash"] == pin.config_hash


def test_mask_hides_locked_content_and_unmask_restores_it() -> None:
    masked = mask_locked_regions(SKILL)
    assert "requires sign-off" not in masked.masked
    assert "SAVANT:LOCKED security-policy" in masked.masked
    assert unmask_locked_regions(masked.masked, masked.regions) == SKILL


@pytest.mark.parametrize("tamper", [
    lambda text: text.replace("<!-- SAVANT:LOCKED security-policy", "<!-- removed"),
    lambda text: text + "\n" + text.splitlines()[-1],
    lambda text: text + "\n<!-- SAVANT:LOCK sneaky -->\nx\n<!-- SAVANT:ENDLOCK -->",
])
def test_unmask_rejects_placeholder_tampering(tamper) -> None:
    masked = mask_locked_regions(SKILL)
    with pytest.raises(LockedRegionError):
        unmask_locked_regions(tamper(masked.masked), masked.regions)


def test_malformed_locks_are_rejected() -> None:
    with pytest.raises(LockedRegionError):
        mask_locked_regions("<!-- SAVANT:LOCK a -->\nnever closed")


def test_mock_optimize_produces_a_bounded_candidate_with_locks_intact() -> None:
    pin = load_engine_pin()
    result = optimize_skill(unit(), MockEngine(), pin)
    assert result.accepted, result.rejection
    assert result.candidate is not None
    assert "trade-offs and operational impact" in result.candidate
    assert "Production deployment requires sign-off." in result.candidate
    assert all(hunk.op == "add" for hunk in result.hunks)
    assert result.rationales and "insufficient-detail" in result.rationales[0]["rationale"]
    assert result.provenance["version"] == "0.2.0"


class LockBreakingEngine(MockEngine):
    def optimize(self, unit, masked_skill, sandbox):  # type: ignore[override]
        return EngineProposal(candidate_masked=masked_skill.replace("SAVANT:LOCKED security-policy", "SAVANT:LOCKED other"))


class RewriteEverythingEngine(MockEngine):
    def optimize(self, unit, masked_skill, sandbox):  # type: ignore[override]
        placeholder = [line for line in masked_skill.splitlines() if "SAVANT:LOCKED" in line][0]
        body = "\n".join(f"- new rule {index}" for index in range(40))
        return EngineProposal(candidate_masked=f"# Rewritten\n{body}\n{placeholder}")


def test_adapter_rejects_lock_tampering_and_budget_overruns() -> None:
    pin = load_engine_pin()
    locked = optimize_skill(unit(), LockBreakingEngine(), pin)
    assert not locked.accepted and "Locked region" in (locked.rejection or "")

    oversized = optimize_skill(unit(), RewriteEverythingEngine(), pin)
    assert not oversized.accepted and "budget" in (oversized.rejection or "").lower()


def test_evaluate_rewards_guidance_that_addresses_failures() -> None:
    pin = load_engine_pin()
    result = optimize_skill(unit(), MockEngine(), pin)
    assert result.candidate
    cases = [case(f"e{index}") for index in range(5)]
    baseline = evaluate_skill(SKILL, cases, MockEngine(), pin, backend="azure-openai", model=None)
    candidate = evaluate_skill(result.candidate, cases, MockEngine(), pin, backend="azure-openai", model=None)
    assert all(candidate[key].overall > baseline[key].overall for key in baseline)
    assert all(candidate[key].dimensions["security-compliance"] == 100.0 for key in candidate)


def test_sandbox_env_is_allowlisted_and_directory_is_removed() -> None:
    policy = SandboxPolicy(env_allowlist=("PATH", "DATABASE_URL", "OPENAI_API_KEY"), egress_allowlist=("api.openai.com",))
    sandbox = Sandbox(policy, base_env={"PATH": "/bin", "DATABASE_URL": "postgres://secret", "OPENAI_API_KEY": "k", "HOME": "/root", "SAVANT_WORKER_TOKEN": "t"})
    with sandbox:
        root = sandbox.workdir
        env = sandbox.build_env()
        assert "DATABASE_URL" not in env, "forbidden variables never pass even if allowlisted"
        assert "SAVANT_WORKER_TOKEN" not in env
        assert env["OPENAI_API_KEY"] == "k"
        assert env["HOME"] == str(root)
        sandbox.assert_egress_allowed("https://api.openai.com/v1")
        with pytest.raises(SandboxError):
            sandbox.assert_egress_allowed("https://evil.example.com")
        with pytest.raises(SandboxError):
            sandbox.path("../escape.txt")
        record = sandbox.run([sys.executable, "-c", "import os; print(os.getcwd())"])
        assert record.exit_code == 0
    assert not root.exists()


def test_sandbox_enforces_timeouts() -> None:
    with Sandbox(SandboxPolicy(timeout_seconds=1, env_allowlist=("PATH", "SYSTEMROOT"))) as sandbox:
        with pytest.raises(SandboxError):
            sandbox.run([sys.executable, "-c", "import time; time.sleep(5)"])
