#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/../backend" && pwd)"

if [[ -n "${BUN_BIN:-}" ]]; then
  BUN="${BUN_BIN}"
elif command -v bun >/dev/null 2>&1; then
  BUN="$(command -v bun)"
elif [[ -x "${HOME}/.bun/bin/bun" ]]; then
  BUN="${HOME}/.bun/bin/bun"
else
  echo "Unable to locate bun. Set BUN_BIN or install bun in PATH." >&2
  exit 1
fi

cd "${BACKEND_DIR}"
exec "${BUN}" run src/mcp/tasks-server.ts
