"""Pinned engine configuration and provenance.

Every optimization run records exactly which engine version, source commit,
optimizer model/backend, and configuration produced a candidate.
"""

from __future__ import annotations

import hashlib
import json
import tomllib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

DEFAULT_LOCK_PATH = Path(__file__).resolve().parents[3] / "skillopt.lock.toml"


@dataclass(frozen=True)
class SandboxPolicy:
    timeout_seconds: int = 1800
    max_memory_mb: int = 4096
    max_output_bytes: int = 5_000_000
    env_allowlist: tuple[str, ...] = ("PATH", "SYSTEMROOT", "TEMP", "TMP")
    egress_allowlist: tuple[str, ...] = ()


@dataclass(frozen=True)
class EnginePin:
    name: str
    display_name: str
    version: str
    source_commit: str | None
    default_model: str
    default_backend: str
    commands: dict[str, tuple[str, ...]] = field(default_factory=dict)
    sandbox: SandboxPolicy = field(default_factory=SandboxPolicy)
    raw: dict[str, Any] = field(default_factory=dict)

    @property
    def config_hash(self) -> str:
        canonical = json.dumps(self.raw, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    def provenance(self, *, optimizer_model: str | None, optimizer_backend: str) -> dict[str, Any]:
        """Matches the control plane's OptimizerProvenance contract."""
        return {
            "engine": "skillopt",
            "engineDisplayName": self.display_name,
            "version": self.version,
            "sourceCommit": self.source_commit,
            "optimizerModel": optimizer_model or self.default_model,
            "optimizerBackend": optimizer_backend,
            "configHash": self.config_hash,
        }


def load_engine_pin(path: Path | str | None = None) -> EnginePin:
    lock_path = Path(path) if path else DEFAULT_LOCK_PATH
    with lock_path.open("rb") as handle:
        raw = tomllib.load(handle)

    engine = raw.get("engine", {})
    optimizer = raw.get("optimizer", {})
    sandbox = raw.get("sandbox", {})
    commands = {key: tuple(str(part) for part in value) for key, value in raw.get("commands", {}).items()}

    if engine.get("name") != "skillopt":
        raise ValueError("skillopt.lock.toml must pin engine.name = 'skillopt'.")
    if not engine.get("version"):
        raise ValueError("skillopt.lock.toml must pin an exact engine.version.")

    return EnginePin(
        name=engine["name"],
        display_name=engine.get("display_name", "Microsoft SkillOpt"),
        version=str(engine["version"]),
        source_commit=engine.get("source_commit") or None,
        default_model=optimizer.get("default_model", "unknown"),
        default_backend=optimizer.get("default_backend", "unknown"),
        commands=commands,
        sandbox=SandboxPolicy(
            timeout_seconds=int(sandbox.get("timeout_seconds", 1800)),
            max_memory_mb=int(sandbox.get("max_memory_mb", 4096)),
            max_output_bytes=int(sandbox.get("max_output_bytes", 5_000_000)),
            env_allowlist=tuple(sandbox.get("env_allowlist", SandboxPolicy.env_allowlist)),
            egress_allowlist=tuple(sandbox.get("egress_allowlist", ())),
        ),
        raw=raw,
    )
