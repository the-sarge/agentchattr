#!/usr/bin/env sh
# agentchattr - starts server (if not running) + Qwen wrapper (auto-approve mode)
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

uv run --project . python wrapper.py qwen  --yolo -i "When asked for a reply or to answer, YOU MUST USE the mcp of agentchattr. When talking about a chat, we are speaking about interaction with tools provided by mcp of agentchattr. The human NEVER SEES your usual CLI interface. Just consider this, other instructions will follow."
