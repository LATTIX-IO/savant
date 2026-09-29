"""CLI for the Skill Intelligence worker.

    # Continuous worker against the control plane (token from SAVANT_WORKER_TOKEN)
    python -m savant_skill_intelligence worker --control-plane http://localhost:3000 --engine mock

    # Process a single saved bundle offline
    python -m savant_skill_intelligence process --bundle bundle.json --out result.json --engine mock

    # Trigger the scheduled health/auto-optimization sweep
    python -m savant_skill_intelligence sweep --control-plane http://localhost:3000
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path

from savant_skillopt_adapter import create_engine, load_engine_pin

from .ingestion.control_plane import ControlPlaneClient
from .worker import process_bundle, run_forever, run_once


def _client(args: argparse.Namespace) -> ControlPlaneClient:
    token = os.environ.get("SAVANT_WORKER_TOKEN", "").strip()
    if not token:
        raise SystemExit("SAVANT_WORKER_TOKEN must be set.")
    return ControlPlaneClient(base_url=args.control_plane, worker_token=token)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="savant_skill_intelligence")
    parser.add_argument("--lock", default=None, help="path to skillopt.lock.toml")
    parser.add_argument("--engine", choices=["mock", "skillopt"], default="mock")
    parser.add_argument("--endpoint", default=os.environ.get("SAVANT_OPTIMIZER_ENDPOINT"), help="optimizer API endpoint (checked against the egress allowlist)")
    parser.add_argument("-v", "--verbose", action="store_true")
    sub = parser.add_subparsers(dest="command", required=True)

    worker = sub.add_parser("worker")
    worker.add_argument("--control-plane", required=True)
    worker.add_argument("--once", action="store_true")
    worker.add_argument("--poll-seconds", type=float, default=30.0)

    process = sub.add_parser("process")
    process.add_argument("--bundle", required=True)
    process.add_argument("--out", required=True)

    sweep = sub.add_parser("sweep")
    sweep.add_argument("--control-plane", required=True)
    sweep.add_argument("--organization-id", default=None)

    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    pin = load_engine_pin(args.lock)
    engine = create_engine(args.engine, pin, endpoint=args.endpoint)

    if args.command == "process":
        bundle = json.loads(Path(args.bundle).read_text(encoding="utf-8"))
        Path(args.out).write_text(json.dumps(process_bundle(bundle, engine, pin), indent=2), encoding="utf-8")
        return 0

    client = _client(args)
    if args.command == "sweep":
        print(json.dumps(client.sweep(args.organization_id), indent=2))
        return 0
    if args.once:
        return 0 if run_once(client, engine, pin) else 3
    run_forever(client, engine, pin, poll_seconds=args.poll_seconds)
    return 0


if __name__ == "__main__":
    sys.exit(main())
