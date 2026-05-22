#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$SCRIPT_DIR"

step() {
  printf '\n==> %s\n' "$1"
}

resolve_command() {
  for candidate in "$@"; do
    if command -v "$candidate" >/dev/null 2>&1; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

pnpm_cmd() {
  if [[ "$WINDOWS_CMD_MODE" == "true" ]]; then
    "$CMD_BIN" /d /s /c "corepack pnpm $*"
    return
  fi

  "$COREPACK_BIN" pnpm "$@"
}

NODE_BIN="$(resolve_command node.exe node)" || {
  printf 'Required command not found: node (or node.exe)\n' >&2
  exit 1
}
GIT_BIN="$(resolve_command git.exe git)" || {
  printf 'Required command not found: git (or git.exe)\n' >&2
  exit 1
}
CMD_BIN=""
COREPACK_BIN=""
COREPACK_CMD_BIN=""
WINDOWS_CMD_MODE="false"

CMD_BIN="$(resolve_command cmd.exe cmd || true)"
COREPACK_CMD_BIN="$(resolve_command corepack.cmd corepack.exe || true)"
COREPACK_BIN="$(resolve_command corepack corepack.exe corepack.cmd)" || {
  printf 'Required command not found: corepack (or corepack.exe/corepack.cmd)\n' >&2
  exit 1
}

if [[ -n "$CMD_BIN" && -n "$COREPACK_CMD_BIN" ]]; then
  WINDOWS_CMD_MODE="true"
  COREPACK_BIN="$COREPACK_CMD_BIN"
fi

"$NODE_BIN" --version >/dev/null
"$GIT_BIN" --version >/dev/null
if [[ "$WINDOWS_CMD_MODE" == "true" ]]; then
  "$CMD_BIN" /d /s /c "corepack --version" >/dev/null
else
  "$COREPACK_BIN" --version >/dev/null
fi

cd "$ROOT_DIR"

step "Installing workspace dependencies"
pnpm_cmd install --frozen-lockfile

step "Scanning production dependencies for known vulnerabilities"
pnpm_cmd run security:deps

step "Scanning repository files for hard-coded secrets"
pnpm_cmd run security:secrets

step "Applying lint fixes"
pnpm_cmd run lint:fix

step "Running tests"
pnpm_cmd test

step "Running full validation gate"
pnpm_cmd check

step "Precommit checks passed"
