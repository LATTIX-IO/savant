"""Isolated execution for optimization engines.

Requirements implemented here:
  - temporary working directory, removed after the job (no persistent filesystem)
  - environment built from an allowlist only: no database credentials, worker
    tokens, or encryption keys can be inherited by the engine process
  - optimizer endpoint checked against an egress allowlist before launch
    (network egress is additionally enforced by the deployment network policy)
  - wall-clock timeout, output size cap, and POSIX CPU/memory limits
  - a structured audit record of every engine invocation

Resource limits via setrlimit are POSIX-only; on other platforms the worker
must run inside a container with equivalent limits.
"""

from __future__ import annotations

import fnmatch
import os
import shutil
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Mapping, Sequence
from urllib.parse import urlparse

from ..config.pin import SandboxPolicy

# Never passed through, even if someone adds them to the allowlist by mistake.
FORBIDDEN_ENV = frozenset({
    "DATABASE_URL",
    "SAVANT_WORKER_TOKEN",
    "TELEMETRY_ENCRYPTION_KEY",
    "AI_CONNECTION_ENCRYPTION_KEY",
    "AUTH0_SECRET",
    "AUTH0_CLIENT_SECRET",
    "STRIPE_SECRET_KEY",
    "GITHUB_WRITE_TOKEN",
    "REPOSITORY_WEBHOOK_SECRET",
})


class SandboxError(RuntimeError):
    pass


@dataclass
class InvocationRecord:
    command: list[str]
    exit_code: int | None
    duration_ms: int
    stdout_bytes: int
    stderr_tail: str
    timed_out: bool


@dataclass
class Sandbox:
    policy: SandboxPolicy
    base_env: Mapping[str, str] = field(default_factory=lambda: dict(os.environ))
    root: Path | None = None
    invocations: list[InvocationRecord] = field(default_factory=list)

    def __enter__(self) -> "Sandbox":
        self.root = Path(tempfile.mkdtemp(prefix="savant-skillopt-"))
        if os.name == "posix":
            os.chmod(self.root, 0o700)
        return self

    def __exit__(self, *_exc: object) -> None:
        self.cleanup()

    def cleanup(self) -> None:
        if self.root and self.root.exists():
            shutil.rmtree(self.root, ignore_errors=True)
        self.root = None

    @property
    def workdir(self) -> Path:
        if self.root is None:
            raise SandboxError("Sandbox is not active; use it as a context manager.")
        return self.root

    def path(self, relative: str) -> Path:
        target = (self.workdir / relative).resolve()
        if self.workdir.resolve() not in target.parents and target != self.workdir.resolve():
            raise SandboxError(f"Path escapes the sandbox: {relative}")
        target.parent.mkdir(parents=True, exist_ok=True)
        return target

    def build_env(self, extra: Mapping[str, str] | None = None) -> dict[str, str]:
        env: dict[str, str] = {}
        for key in self.policy.env_allowlist:
            if key in FORBIDDEN_ENV:
                continue
            if key in self.base_env:
                env[key] = self.base_env[key]
        home = str(self.workdir)
        env.update({"HOME": home, "USERPROFILE": home, "TMPDIR": home, "PYTHONNOUSERSITE": "1"})
        env["SAVANT_EGRESS_ALLOWLIST"] = ",".join(self.policy.egress_allowlist)
        for key, value in (extra or {}).items():
            if key not in FORBIDDEN_ENV:
                env[key] = value
        return env

    def assert_egress_allowed(self, endpoint: str | None) -> None:
        if not endpoint:
            return
        host = urlparse(endpoint if "://" in endpoint else f"https://{endpoint}").hostname or ""
        if not any(fnmatch.fnmatch(host, pattern) for pattern in self.policy.egress_allowlist):
            raise SandboxError(f"Optimizer endpoint host '{host}' is not in the egress allowlist.")

    def _limit_resources(self) -> None:  # pragma: no cover - runs in the child
        import resource

        memory = self.policy.max_memory_mb * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (memory, memory))
        resource.setrlimit(resource.RLIMIT_CPU, (self.policy.timeout_seconds, self.policy.timeout_seconds))

    def run(self, command: Sequence[str], *, extra_env: Mapping[str, str] | None = None) -> InvocationRecord:
        started = time.monotonic()
        timed_out = False
        exit_code: int | None = None
        stdout = b""
        stderr = b""
        try:
            completed = subprocess.run(
                list(command),
                cwd=self.workdir,
                env=self.build_env(extra_env),
                stdin=subprocess.DEVNULL,
                capture_output=True,
                timeout=self.policy.timeout_seconds,
                check=False,
                preexec_fn=self._limit_resources if sys.platform != "win32" else None,  # noqa: PLW1509
            )
            exit_code = completed.returncode
            stdout, stderr = completed.stdout, completed.stderr
        except subprocess.TimeoutExpired as expired:
            timed_out = True
            stdout = expired.stdout or b""
            stderr = expired.stderr or b""
        except FileNotFoundError as missing:
            raise SandboxError(f"Engine executable not found: {missing.filename}") from missing

        if len(stdout) > self.policy.max_output_bytes:
            raise SandboxError("Engine output exceeded the sandbox output cap.")

        record = InvocationRecord(
            command=list(command),
            exit_code=exit_code,
            duration_ms=int((time.monotonic() - started) * 1000),
            stdout_bytes=len(stdout),
            stderr_tail=stderr[-2000:].decode("utf-8", errors="replace"),
            timed_out=timed_out,
        )
        self.invocations.append(record)
        if timed_out:
            raise SandboxError(f"Engine timed out after {self.policy.timeout_seconds}s.")
        return record
