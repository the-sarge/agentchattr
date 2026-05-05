# Temporary Test Checklist

Use this to manually test the runner, metadata APIs, Agent Operations panel, and search/command palette before we package or PR the work.

## Setup

- From the repo root for this checkout:
  ```bash
  cd /Users/josh/code/github.com/the-sarge/agentchattr
  ```

- Make sure the venv has app and test dependencies:
  ```bash
  .venv/bin/python -m pip install -q -r requirements.txt pytest
  ```

- Run the Python suite:
  ```bash
  .venv/bin/python -m pytest -q
  ```
- Confirm these pass before manual QA:
  ```bash
  node --check static/agent-ops.js
  node --check static/search-nav.js
  ```

## Runner Smoke

- List known projects:
  ```bash
  ./ac list
  ```
  Expected: examples are ignored unless copied to `.toml`; no crash if no real team files exist.

- Dry-run a team example:
  ```bash
  ./ac two-agent up --dry-run -f teams/two-agent.toml.example
  ```
  Expected: prints team file, web/MCP ports, data/upload dirs, tmux prefix, server/wrapper/live session names, and exact commands. It should not create tmux sessions or start servers.

- Optional real tmux smoke, only if you have the configured commands on `PATH`:
  ```bash
  cp teams/two-agent.toml.example teams/two-agent.toml
  ./ac two-agent up
  ./ac two-agent status
  ./ac two-agent logs server --lines 80
  ./ac two-agent restart builder
  ./ac two-agent down
  ```
  Expected: restart affects only `builder` live/wrapper sessions; server and `architect` stay untouched.

## Server/API Smoke

- Start the app:
  ```bash
  .venv/bin/python run.py
  ```
- Copy the printed session token.
- In another terminal, verify:
  ```bash
  curl -fsS -H 'X-Session-Token: TOKEN_HERE' http://127.0.0.1:8300/api/project
  curl -fsS -H 'X-Session-Token: TOKEN_HERE' http://127.0.0.1:8300/api/agent-ops
  ```
  Expected: `/api/project` includes name/title/accent/team file/tmux prefix/ports/paths. `/api/agent-ops` includes service badges, configured agents, registered agents, tmux sessions, attach commands, and mismatch lists.

## Browser UI

- Open `http://127.0.0.1:8300`.
- Header:
  - Project badge appears next to the title.
  - Browser tab title is `<project> - agentchattr`, except the default project should stay exactly `agentchattr`.
  - Existing header buttons still work: Jobs, Rules, Pins, Settings, Help.
  - Agent/status pills appear in the right-side Agents rail by default, not in the header.
  - Opening Jobs, Rules, or Agent Operations hides the Agents rail so the active panel has enough room.

- Agent Operations:
  - Click the operations/sliders button in the header.
  - Panel opens wider on the right without breaking timeline layout.
  - Project section shows tmux prefix, data dir, upload dir, team/default config, and repo/board links when configured.
  - Long data/upload/team paths wrap cleanly and do not collide with labels.
  - Services section owns the web/MCP port rows; Project should not repeat them.
  - Configured agents show label, handle, provider/type, configured role even when the agent is offline/missing, heartbeat age, live/wrapper attach commands.
  - Warning rows appear for configured agents that are not registered.
  - Copy buttons place attach commands on the clipboard.
  - Closing and reopening refreshes the data.

- Search and command palette:
  - Press `Cmd+K` on macOS or `Ctrl+K` elsewhere.
  - Palette opens and focuses the input.
  - Type text from an existing message and confirm matching message rows appear.
  - Type `general`. Expected: `Switch to #general` is the first match, and message rows only appear if their message body contains `general`.
  - Type any other channel name. Expected: a `Switch to #channel` command appears before message-content matches, and Enter switches channels.
  - Type `@sendername`. Expected: message rows from that sender appear; typing the bare sender name should not match every message by that sender unless the body contains it.
  - Type `jobs`. Expected: `Open Jobs` appears without needing a `>` prefix.
  - Type a command-like query without `>`. Expected: command rows still match.
  - Optional: type `>` to restrict results to commands only.
  - Try filters: sender, channel, pinned, todo, done, jobs, sessions, system.
  - Press Enter on a message result. Expected: switches to the message channel if needed and scrolls/highlights the message.
  - Run commands for channel switching, Jobs, Rules, Agent Operations, and pinned items.
  - Verify attach-copy commands appear when `/api/agent-ops` has configured agents.
  - Escape closes the palette.

- Channels and layout defaults:
  - Reload in a clean browser profile or clear local storage. Expected: Agents rail opens on the left and Channels sidebar opens on the right by default.
  - Open Settings and set `Sidebars` to `Agents left`. Expected: Agents rail moves left and Channels sidebar moves right.
  - Set `Sidebars` to `Channels left`. Expected: Channels sidebar moves left and Agents rail moves right.
  - Create and rename a 24-character channel, e.g. `abcdefghijklmnopqrstuvwx`.
  - Confirm a 25-character channel is rejected.
  - Resize the channel sidebar and confirm longer names remain usable.

- Settings and command cleanup:
  - Open Settings. Expected: loop guard default is `100` and History includes `1000`.
  - Type `/` in the message box. Expected: `/roastreview` remains, but `/artchallenge`, `/hatmaking`, and `/poetry ...` commands are gone.
  - Type `@all`. Expected: the mention remains `@all`, not `@all agents`.

- Project links:
  - Add `repo_url` and `board_url` under `[project]` in a team file and restart.
  - Expected: `/api/project` returns both URLs, Agent Operations shows them, and the old Support link becomes `Project Board`.
  - Optional: set `link_label` and `link_url` under `[project]`. Expected: those override the pill label and URL.

## Regression Checks

- Send a normal chat message.
- Reload. Expected: your own existing message bubbles stay right-aligned.
- Press `Cmd+.` on macOS or `Ctrl+.` elsewhere. Expected: cursor moves to the main message field without using the mouse.
- Create/switch channels.
- Open and close Jobs and Rules panels.
- Pin/unpin a message.
- Change Settings and reload the page.
- Confirm WebSocket reconnect still loads history without duplicate visible UI.

## Notes To Capture

Record:

- Browser/OS.
- Exact command used to start the server.
- Whether testing default `config.toml` or a team file.
- Any console errors from browser devtools.
- Any server traceback.
- Screenshots for layout problems, especially narrow/mobile widths.
