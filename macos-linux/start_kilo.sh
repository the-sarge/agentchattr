#!/usr/bin/env sh
# agentchattr - starts server (if not running) + Kilo wrapper
# Usage: sh start_kilo.sh [provider/model]
#   e.g. sh start_kilo.sh anthropic/claude-sonnet-4-20250514
#   Omit the model to use Kilo's configured default.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR/.."
. "$SCRIPT_DIR/common.sh"

is_server_running() {
    lsof -i :8300 -sTCP:LISTEN >/dev/null 2>&1 || \
    ss -tlnp 2>/dev/null | grep -q ':8300 '
}

require_uv

if ! is_server_running; then
    if [ "$(uname -s)" = "Darwin" ]; then
        osascript -e "tell app \"Terminal\" to do script \"cd '$(pwd)' && uv run --project . python run.py\"" > /dev/null 2>&1
    else
        if command -v gnome-terminal >/dev/null 2>&1; then
            gnome-terminal -- sh -c "cd '$(pwd)' && uv run --project . python run.py; printf 'Press Enter to close... '; read _"
        elif command -v xterm >/dev/null 2>&1; then
            xterm -e sh -c "cd '$(pwd)' && uv run --project . python run.py" &
        else
            uv run --project . python run.py > data/server.log 2>&1 &
        fi
    fi

    i=0
    while [ "$i" -lt 30 ]; do
        if is_server_running; then
            break
        fi
        sleep 0.5
        i=$((i + 1))
    done
fi

if [ -n "$1" ]; then
    uv run --project . python wrapper.py kilo -- -m "$1"
else
    uv run --project . python wrapper.py kilo
fi
