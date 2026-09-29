"""`python -m savant_skillopt_adapter doctor` — verify the pinned engine is usable."""

from __future__ import annotations

import argparse
import json
import shutil
import sys

from .config.pin import load_engine_pin


def doctor(lock: str | None) -> int:
    pin = load_engine_pin(lock)
    executable = pin.commands.get("optimize", ("skillopt",))[0]
    report = {
        "engine": pin.display_name,
        "version": pin.version,
        "sourceCommit": pin.source_commit,
        "configHash": pin.config_hash,
        "executable": shutil.which(executable),
        "commands": sorted(pin.commands),
        "egressAllowlist": list(pin.sandbox.egress_allowlist),
    }
    installed = None
    try:
        from importlib.metadata import version

        installed = version("skillopt")
    except Exception:  # noqa: BLE001 - optional dependency
        installed = None
    report["installedVersion"] = installed

    print(json.dumps(report, indent=2))
    if installed and installed != pin.version:
        print(f"ERROR: installed skillopt {installed} does not match pinned {pin.version}", file=sys.stderr)
        return 2
    if report["executable"] is None:
        print("WARNING: SkillOpt CLI not found on PATH; only the mock engine is available.", file=sys.stderr)
        return 1
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="savant_skillopt_adapter")
    sub = parser.add_subparsers(dest="command", required=True)
    doctor_parser = sub.add_parser("doctor", help="check the pinned SkillOpt installation")
    doctor_parser.add_argument("--lock", default=None)
    args = parser.parse_args(argv)
    if args.command == "doctor":
        return doctor(args.lock)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
