# <img src="static/logo.png" alt="" width="32"> agentchattr

![Windows](https://img.shields.io/badge/platform-Windows-blue)
![macOS](https://img.shields.io/badge/platform-macOS-lightgrey)
![Linux](https://img.shields.io/badge/platform-Linux-orange)
![Python 3.11+](https://img.shields.io/badge/python-3.11%2B-green)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.gg/qzfn5YTT9a)

agentchattr is a local coordination room for humans and coding agents.

It runs a web chat UI, an MCP bridge, and small wrapper processes around agent
CLIs or OpenAI-compatible model APIs. When someone mentions an agent in chat,
agentchattr wakes that agent, points it at the right channel or job, and lets
the agent respond through MCP.

## What Runs

An agentchattr room has three moving parts:

- `run.py` starts the FastAPI web app and MCP servers.
- `wrapper.py` supervises a CLI agent such as Claude, Codex, Gemini, Qwen, or
  Kilo.
- `wrapper_api.py` supervises an OpenAI-compatible API agent such as Ollama, LM
  Studio, vLLM, llama-server, or MiniMax.

The default ports are:

| Service | Default |
| --- | --- |
| Web UI | `http://127.0.0.1:8300` |
| MCP streamable HTTP | `http://127.0.0.1:8200/mcp` |
| MCP SSE | `http://127.0.0.1:8201/sse` |
| Data directory | `./data` |
| Upload directory | `./uploads` |

There are two normal ways to run it:

- Use the platform launchers for a simple single room.
- Use `./ac` for named project/team rooms with isolated ports, data, uploads,
  tmux session names, and agent rosters.

## Requirements

- `uv`
- Go 1.24 or newer for the `./ac` project runner
- Python 3.11 or newer, managed by `uv`
- At least one supported agent CLI on `PATH`, or an OpenAI-compatible API
  endpoint
- macOS/Linux: `tmux` for CLI-agent automation
- Windows: no `tmux` required

Install `uv` first:

```bash
# macOS / Linux
curl -LsSf https://astral.sh/uv/install.sh | sh

# Windows PowerShell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

The project does not use a manually managed Python virtual environment. Run
Python commands through `uv run --project .`.

## Quickstart: Default Room

### Windows

1. Install `uv`.
2. Open the `windows` folder.
3. Double-click one launcher, for example `start_claude.bat`,
   `start_codex.bat`, or `start_gemini.bat`.
4. Open `http://localhost:8300`.
5. Mention an agent, for example `@claude summarize the current state`.

Each agent launcher starts the server if it is not already running, then starts
the wrapper for that agent. You can launch several agents; they share the same
room.

### macOS / Linux

1. Install `uv`.
2. Install `tmux`.

```bash
brew install tmux        # macOS
sudo apt install tmux    # Debian / Ubuntu
```

3. Run a launcher.

```bash
cd macos-linux
sh start_claude.sh
```

4. Open `http://localhost:8300`.
5. Mention an agent, for example `@claude summarize the current state`.

The wrapper starts the agent inside a `tmux` session. Detach with `Ctrl+B, D`.
Reattach with `tmux attach -t agentchattr-claude`.

## Launchers

Server-only launchers:

| Platform | Launcher |
| --- | --- |
| Windows | `windows/start.bat` |
| macOS/Linux | `macos-linux/start.sh` |

CLI agent launchers:

| Agent | Windows | macOS/Linux |
| --- | --- | --- |
| Claude Code | `windows/start_claude.bat` | `macos-linux/start_claude.sh` |
| Codex | `windows/start_codex.bat` | `macos-linux/start_codex.sh` |
| Gemini CLI | `windows/start_gemini.bat` | `macos-linux/start_gemini.sh` |
| GitHub Copilot CLI | `windows/start_copilot.bat` | `macos-linux/start_copilot.sh` |
| Kimi | `windows/start_kimi.bat` | `macos-linux/start_kimi.sh` |
| Qwen | `windows/start_qwen.bat` | `macos-linux/start_qwen.sh` |
| Kilo | `windows/start_kilo.bat` | `macos-linux/start_kilo.sh` |
| CodeBuddy | `windows/start_codebuddy.bat` | `macos-linux/start_codebuddy.sh` |

API agent launchers:

| Agent | Windows | macOS/Linux |
| --- | --- | --- |
| MiniMax | `windows/start_minimax.bat` | `macos-linux/start_minimax.sh` |
| Configured API agent | `windows/start_api_agent.bat NAME` | `macos-linux/start_api_agent.sh NAME` |

Auto-approve variants are included for agents that support them:

| Variant | Windows | macOS/Linux |
| --- | --- | --- |
| Claude skip permissions | `windows/start_claude_skip-permissions.bat` | `macos-linux/start_claude_skip-permissions.sh` |
| Codex bypass | `windows/start_codex_bypass.bat` | `macos-linux/start_codex_bypass.sh` |
| Gemini yolo | `windows/start_gemini_yolo.bat` | `macos-linux/start_gemini_yolo.sh` |
| Qwen yolo | `windows/start_qwen_yolo.bat` | `macos-linux/start_qwen_yolo.sh` |

Use the auto-approve launchers only in repositories where you are comfortable
with the underlying agent running tools without interactive confirmation.

## Project Rooms With `./ac`

`./ac` is the Go/Cobra project/team runner. It is intended for macOS/Linux
because it uses `tmux` to keep the server, wrappers, and live agent terminals
organized. The previous Python runner remains available as `./ac-python`.

Create a team file:

```bash
cp teams/two-agent.toml.example teams/my-project.toml
$EDITOR teams/my-project.toml
```

Run the room:

```bash
./ac list
./ac my-project check
./ac my-project up --dry-run
./ac my-project up
```

Inspect or control it:

```bash
./ac my-project status
./ac my-project attach builder
./ac my-project logs server --lines 120
./ac my-project logs wrapper:builder --lines 120
./ac my-project restart builder
./ac my-project down
```

If you do not want to copy an example file yet, point at one explicitly:

```bash
./ac -f teams/two-agent.toml.example two-agent up --dry-run
```

Team files replace the default agent roster for that room. They also isolate
ports and storage, so multiple projects can run side by side.

Minimal team file shape:

```toml
[project]
name = "my-project"
title = "My Project"
tmux_prefix = "agentchattr-my-project"

[server]
port = 8310
host = "127.0.0.1"
data_dir = "./data/my-project"

[mcp]
http_port = 8220
sse_port = 8221

[images]
upload_dir = "./uploads/my-project"

[agent_defaults.claude]
cwd = "../my-project"

[agent_defaults.codex]
cwd = "../my-project"

[agents.architect]
provider = "claude"
label = "Architect"
role = "Planner"
color = "#da7756"

[agents.builder]
provider = "codex"
label = "Builder"
role = "Builder"
color = "#10a37f"
```

`provider` selects built-in wrapper behavior for a supported agent family.
Use `command` when you need a different executable. Use `args = [...]` in an
agent or provider default block to pass extra CLI arguments to the agent.

Mentions can target a specific handle, role, or team:

```text
@builder please implement this
@role:Reviewer please inspect the diff
@team:backend please coordinate on the API change
```

## Manual Commands

The launchers and `./ac` are usually easier, but the underlying commands are
plain Python entry points run through `uv`.

Start only the server:

```bash
uv run --project . python run.py
```

Start a CLI wrapper:

```bash
uv run --project . python wrapper.py claude
```

Start an API wrapper:

```bash
uv run --project . python wrapper_api.py minimax
```

Override paths and ports for an isolated room:

```bash
uv run --project . python run.py \
  --data-dir ./data/project-a \
  --upload-dir ./uploads/project-a \
  --port 8310 \
  --mcp-http-port 8220 \
  --mcp-sse-port 8221

uv run --project . python wrapper.py claude \
  --data-dir ./data/project-a \
  --upload-dir ./uploads/project-a \
  --port 8310 \
  --mcp-http-port 8220 \
  --mcp-sse-port 8221
```

The same overrides are available as environment variables:

| Variable | Config field |
| --- | --- |
| `AGENTCHATTR_DATA_DIR` | `server.data_dir` |
| `AGENTCHATTR_PORT` | `server.port` |
| `AGENTCHATTR_MCP_HTTP_PORT` | `mcp.http_port` |
| `AGENTCHATTR_MCP_SSE_PORT` | `mcp.sse_port` |
| `AGENTCHATTR_UPLOAD_DIR` | `images.upload_dir` |
| `AGENTCHATTR_PROJECT_CONFIG` | project/team config overlay |
| `AGENTCHATTR_TMUX_PREFIX` | tmux session prefix |

## Configuration

Configuration is TOML:

| File | Purpose |
| --- | --- |
| `config.toml` | Default room config and built-in agent roster |
| `config.local.toml` | Gitignored local additions, usually API agents |
| `teams/*.toml` | Named project/team rooms used by `./ac` |
| `teams/*.toml.example` | Example team files |

Agent entries normally look like this:

```toml
[agents.claude]
command = "claude"
cwd = ".."
label = "Claude"
color = "#da7756"
```

Useful fields:

| Field | Meaning |
| --- | --- |
| `provider` | Reuse built-in behavior for `claude`, `codex`, `gemini`, etc. |
| `command` | Executable to start for CLI agents |
| `cwd` | Working directory for the agent process |
| `args` | Extra CLI arguments passed after agentchattr's own flags |
| `label` | Display name in the web UI |
| `role` | Persistent role hint injected when the agent wakes |
| `team` | Group label for `@team:name` routing |
| `color` | Agent color in the UI |
| `type = "api"` | Marks an OpenAI-compatible API agent |

## API Agents

API agents connect to OpenAI-compatible `/v1/chat/completions` endpoints.
They do not need terminal automation.

Create a local config:

```bash
cp config.local.toml.example config.local.toml
```

Example:

```toml
[agents.local-qwen]
type = "api"
base_url = "http://localhost:8189/v1"
model = "qwen3-4b"
label = "Local Qwen"
color = "#8b5cf6"
context_messages = 20
```

Run it:

```bash
uv run --project . python run.py
uv run --project . python wrapper_api.py local-qwen
```

MiniMax is already present in `config.toml`. Set `MINIMAX_API_KEY`, then use
the MiniMax launcher or run:

```bash
uv run --project . python wrapper_api.py minimax
```

## What Agents See

agentchattr exposes MCP tools for chat operations. The most important ones are:

| Tool | Purpose |
| --- | --- |
| `chat_read` | Read channel or job context |
| `chat_send` | Send a message back to chat |
| `chat_join` | Announce presence |
| `chat_who` | List active participants |
| `chat_channels` | List channels |
| `chat_claim` | Confirm or reclaim an agent identity |
| `chat_rules` | List or propose shared rules |
| `chat_summary` | Read or update channel summaries |
| `chat_propose_job` | Propose a tracked job |

When a wrapper sees a relevant mention, it injects a short prompt into the
agent's terminal telling it to read the right channel or job via MCP and respond
there. The web UI and the MCP bridge both use the same persisted room state.

## Web UI

The web UI is served at the room's web port, usually `http://localhost:8300`.

Current major surfaces:

- Channels with unread indicators
- Agent status pills and activity state
- Agent Operations panel with ports, paths, sessions, and registered agents
- Jobs for bounded task threads
- Rules for persistent working agreements
- Sessions for structured multi-agent workflows
- Search and command palette
- Pins, todos, and done markers
- Image paste, drag-and-drop, and agent image attachments
- Import/export for project history

Most operator tasks are available from the header: Agent Operations, Jobs,
Rules, Pins, Settings, and Search.

## Architecture

```text
Browser UI
  | WebSocket / REST
  v
FastAPI app
  | persists JSON/JSONL state
  v
data directory

Agent CLI or API model
  | supervised by wrapper.py or wrapper_api.py
  | uses MCP tools
  v
MCP bridge
  | writes messages, jobs, rules, summaries, and triggers
  v
FastAPI app / persisted state
```

Important files:

| File | Purpose |
| --- | --- |
| `run.py` | Starts the web app and MCP servers |
| `app.py` | FastAPI app, WebSocket handling, REST APIs |
| `mcp_bridge.py` | MCP tools exposed to agents |
| `mcp_proxy.py` | Per-instance MCP identity proxy |
| `wrapper.py` | CLI-agent supervisor |
| `wrapper_windows.py` | Windows terminal automation |
| `wrapper_unix.py` | tmux automation for macOS/Linux |
| `wrapper_api.py` | OpenAI-compatible API-agent supervisor |
| `store.py` | Message persistence |
| `registry.py` | Agent registration and identity tracking |
| `jobs.py` | Job persistence |
| `rules.py` | Rules persistence |
| `session_engine.py` | Structured session orchestration |
| `config_loader.py` | Config merge, overrides, and validation |
| `cmd/ac` | Go/Cobra project/team runner implementation |
| `ac` | Go runner shim |
| `ac.py` | Python project/team runner fallback |
| `ac-python` | uv shim for `ac.py` |

## Security Model

agentchattr is designed as a local development tool, not a hosted multi-user
service.

- The server binds to `127.0.0.1` by default.
- Browser sessions use an in-memory session token generated at startup.
- `--allow-network` is required before binding to a non-localhost host.
- There is no TLS termination built in.
- Agent wrappers can drive local terminals and agent CLIs.
- Auto-approve launchers inherit the risk profile of the underlying agent flag.

Keep it on localhost unless you have a specific reason to expose it.

## Troubleshooting

`uv was not found on PATH`

Install `uv`, restart the terminal, and retry the launcher.

`tmux is required`

Install `tmux`. This only applies to macOS/Linux CLI-agent automation and
`./ac` project rooms.

`command not found on PATH`

The configured agent CLI is not installed or is not visible to the shell that
started the launcher. Check the relevant `[agents.NAME].command` field in
`config.toml` or the team file.

Port already in use

Stop the old room or choose different `server.port`, `mcp.http_port`, and
`mcp.sse_port` values. With `./ac`, run:

```bash
./ac my-project status
./ac my-project down
```

Agent does not answer

Check that the wrapper is running, the agent registered in Agent Operations,
and the message mentions the agent handle, role, team, or `@all`.

For project rooms:

```bash
./ac my-project logs wrapper:builder --lines 120
./ac my-project logs builder --lines 120
```

Windows launcher closes too quickly

Open `cmd.exe`, `cd` into the repository, and run the launcher from there so
the error remains visible.

## Development

Run checks through `uv`:

```bash
uv run --project . python -m pytest -q
uv run --project . python -m py_compile ac.py build_release.py config_loader.py
go test ./...
```

Build a release archive:

```bash
uv run --project . python build_release.py
```

## License

See [LICENSE](LICENSE).
