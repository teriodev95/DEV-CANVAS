#!/usr/bin/env bash
# Build the Bun backend as a standalone sidecar binary for Tauri.
# Run from the repo root: ./scripts/build-sidecar.sh [target-triple]
#
# Default target is the current host triple. For cross-compilation:
#   ./scripts/build-sidecar.sh aarch64-apple-darwin   # Apple Silicon
#   ./scripts/build-sidecar.sh x86_64-apple-darwin    # Intel Mac

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$REPO_ROOT/backend"
SIDECAR_DIR="$REPO_ROOT/frontend/src-tauri/binaries"

# Determine target triple
if [ -n "${1:-}" ]; then
  TARGET="$1"
else
  # Auto-detect from rustc
  TARGET=$(rustc -vV 2>/dev/null | grep 'host:' | awk '{print $2}' || true)
  if [ -z "$TARGET" ]; then
    echo "❌ Could not detect target triple. Install Rust or pass triple explicitly."
    echo "   Usage: $0 aarch64-apple-darwin"
    exit 1
  fi
fi

mkdir -p "$SIDECAR_DIR"
OUTPUT="$SIDECAR_DIR/devcanvas-backend-$TARGET"

echo "→ Building Bun backend sidecar for target: $TARGET"
echo "→ Output: $OUTPUT"

cd "$BACKEND_DIR"
bun build \
  --compile \
  --target=bun \
  --outfile="$OUTPUT" \
  src/index.ts

echo "✓ Sidecar binary built: $OUTPUT"
