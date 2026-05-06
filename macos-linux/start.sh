#!/usr/bin/env sh
# agentchattr - starts the server only
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR/.."
. "$SCRIPT_DIR/common.sh"

require_uv

uv run --project . python run.py
code=$?
echo ""
echo "=== Server exited with code $code ==="
exit "$code"
