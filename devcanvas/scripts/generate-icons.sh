#!/usr/bin/env bash
# Generate Tauri icon set from the SVG source icon.
# Requires: @tauri-apps/cli (installed via npm run tauri icon)
#
# Run from the repo root after installing dependencies:
#   cd frontend && npm run tauri -- icon ../static/icon.svg

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FRONTEND_DIR="$REPO_ROOT/frontend"
ICON_SRC="$FRONTEND_DIR/static/icon.svg"

if [ ! -f "$ICON_SRC" ]; then
  echo "❌ Icon source not found: $ICON_SRC"
  exit 1
fi

cd "$FRONTEND_DIR"
echo "→ Generating Tauri icons from $ICON_SRC"
npx @tauri-apps/cli icon "$ICON_SRC"
echo "✓ Icons generated in src-tauri/icons/"
