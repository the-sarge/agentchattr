# agentchattr Team Runner Guide

This guide covers the project/team workflow driven by `./ac`.

The goal is to define a repeatable roster per project, then start, inspect,
attach to, and stop that project without manually renaming agents in the UI.

`./ac` is currently a Go/Cobra runner. It shells out to `tmux` for process
control and still launches the Python server and wrappers through `uv`. The
previous Python runner remains available as `./ac-python` while the Go runner
settles.

## Requirements

- Go 1.24 or newer for `./ac`
- `uv` for the Python server and wrappers that `./ac` launches
- `tmux` on macOS/Linux
- configured agent CLIs on `PATH`, unless a team uses only API agents

The first `./ac` run may download Go module dependencies.

## Concepts

A **team file** is a TOML file that defines one project-specific agentchattr
instance:

- web server port
- MCP ports
- data and upload directories
- tmux session prefix
- agent roster
- names, labels, colors, and roles

`./ac` reads the team file, starts the server in tmux, then starts one wrapper
per configured agent. Each wrapper starts the actual agent CLI in its own tmux
session.

## Quick Start

Create a project team file:

```bash
cp teams/two-agent.toml.example teams/two-agent.toml
```

Edit ports, paths, and agents as needed, then start it:

```bash
./ac list
./ac two-agent up --dry-run
./ac two-agent check
./ac two-agent up
```

Check status:

```bash
./ac two-agent status
```

Attach to an agent:

```bash
./ac two-agent attach architect
```

Stop the project:

```bash
./ac two-agent down
```

## Team File Location

By default, `./ac project-a up` looks for:

```text
teams/project-a.toml
projects/project-a.toml
project-a.toml
```

You can also pass an explicit file:

```bash
./ac project-a up -f /path/to/project-a.toml
```

## Team File Example

```toml
[project]
name = "project-a"
title = "Project A"
accent_color = "#7c3aed"
tmux_prefix = "agentchattr-project-a"
# repo_url = "https://github.com/owner/repo"
# board_url = "https://github.com/orgs/owner/projects/1"  # replaces Support pill with "Project Board"
# link_label = "Project Board"  # optional override for the pill label
# link_url = "https://github.com/orgs/owner/projects/1/views/1"  # optional override for the pill URL

[server]
port = 8301
host = "127.0.0.1"
data_dir = "./data/project-a"

[mcp]
http_port = 8211
sse_port = 8212

[images]
upload_dir = "./uploads/project-a"

[routing]
default = "none"
max_agent_hops = 100

[agent_defaults.claude]
cwd = ".."

[agents.claude-planner]
provider = "claude"
color = "#da7756"
label = "Claude Planner"
role = "Planner"

[agents.codex-builder]
provider = "codex"
cwd = ".."
color = "#10a37f"
label = "Codex Builder"
role = "Builder"

[agents.gemini-research]
provider = "gemini"
cwd = ".."
color = "#4285f4"
label = "Gemini Research"
role = "Researcher"
```

Additional examples are available under `teams/`:

- `teams/two-agent.toml.example`
- `teams/large-roster.toml.example`
- `teams/api-agent.toml.example`

## Agent Fields

Each `[agents.<name>]` entry defines a handle. The handle is what you mention
in chat, for example `@claude-planner`.

Common fields:

- `provider`: built-in provider behavior to use: `claude`, `codex`, `gemini`,
  `kimi`, `qwen`, `kilo`, `codebuddy`, or `copilot`
- `command`: optional executable path. If omitted, defaults to `provider`
- `cwd`: working directory for the agent CLI
- `color`: status pill and mention color
- `label`: display label in the UI
- `role`: role text injected into the agent when it is triggered
- `team`: optional group label used by the UI and `@team:<name>` routing
- `args`: extra provider CLI arguments appended after agentchattr-owned MCP
  arguments and before ad hoc wrapper pass-through arguments

Routing examples:

- `@architect` routes to the single agent handle named `architect`.
- `@team:1` routes to agents configured with `team = "1"`.
- `@role:Builder` routes to agents whose current role is `Builder`.
- Mentions inside inline code or fenced code blocks are ignored for routing.

For normal aliases, prefer `provider` and omit `command`:

```toml
[agents.architect]
provider = "claude"
```

Use `command` when testing or when the executable is not on `PATH`:

```toml
[agents.architect]
provider = "claude"
command = "/opt/bin/claude"
```

Shared defaults reduce repeated fields:

```toml
[agent_defaults.codex]
cwd = ".."
args = ["--ask-for-approval", "never"]

[agents.codex-builder]
provider = "codex"
label = "Codex Builder"
```

Per-agent values override matching `[agent_defaults.<provider>]` values.

## Validation And Dry Runs

Preview a project without starting tmux sessions:

```bash
./ac project-a up --dry-run
```

The dry run prints the team file, ports, data paths, tmux session names, and
commands that would be used.

Run the full preflight before launch:

```bash
./ac project-a check
```

`check` validates:

- team file structure
- duplicate ports and tmux prefixes across known `teams/*.toml` and
  `projects/*.toml` files
- missing agent commands
- data/upload paths that point at files
- missing or non-directory agent `cwd` values

Team labels must be unique, and `role` / `team` values must use letters,
numbers, and single spaces, dots, underscores, or hyphens so `@role:<name>`
and `@team:<name>` routing can address them reliably. For values with spaces,
mention the normalized hyphen form, for example `role = "Code Review"` is
addressed as `@role:Code-Review`. Team and role routing is intentionally
documented first; autocomplete hints can be layered into the web UI later.

## Multiple Projects

Each project must use unique ports and a unique tmux prefix:

```toml
[project]
tmux_prefix = "agentchattr-project-b"

[server]
port = 8302

[mcp]
http_port = 8221
sse_port = 8222
```

Then run projects side by side:

```bash
./ac project-a up
./ac project-b up
./ac project-c up
```

Each project has isolated runtime state if its `data_dir` and `upload_dir` are
different.

## Tmux Naming Convention

For a project with:

```toml
[project]
tmux_prefix = "agentchattr-project-a"

[agents.claude-planner]
provider = "claude"
```

tmux sessions are named:

```text
agentchattr-project-a-server
agentchattr-project-a-wrap-claude-planner
agentchattr-project-a-claude-planner
```

Use these targets:

- `server`: the FastAPI/MCP server
- `<agent>`: the live agent CLI session
- `wrapper:<agent>`: the wrapper supervisor for that agent

Examples:

```bash
./ac project-a attach server
./ac project-a attach claude-planner
./ac project-a attach wrapper:claude-planner
```

For a hung or confused agent, attach to the live agent session, not the wrapper:

```bash
./ac project-a attach claude-planner
```

Detach from tmux without stopping the agent:

```text
Ctrl+B, then D
```

## Status

Inspect the same operational categories shown in Agent Operations:

```bash
./ac project-a status
```

`status` reports Server, MCP HTTP, and MCP SSE listening state, then each
configured agent's live tmux session and wrapper supervisor state. A
`wrapper only` row means the supervisor is still running but the live agent tmux
session is gone. A `live only` row means the agent pane is present without its
wrapper supervisor. Extra prefixed tmux sessions are shown as
running-but-not-configured warnings.

## Restarting One Agent

Restart one wrapper/live agent pair without touching the server or other
agents:

```bash
./ac project-a restart claude-planner
```

This kills:

```text
agentchattr-project-a-claude-planner
agentchattr-project-a-wrap-claude-planner
```

Then it starts the wrapper again. The wrapper creates the live agent tmux
session.

## Logs

Capture recent tmux pane output without attaching:

```bash
./ac project-a logs server
./ac project-a logs claude-planner --lines 300
./ac project-a logs wrapper:claude-planner
```

The default is `--lines 200`. `logs server` reads the persisted
`data_dir/server.log` first, so it still works after an early server crash has
closed the tmux pane. Agent and wrapper targets capture the relevant tmux pane;
a raw tmux session name also works as the target.

## Stopping A Project

Stop one project:

```bash
./ac project-a down
```

This kills tmux sessions whose names start with that project’s `tmux_prefix`.
It should not stop other projects with different prefixes.

## Data Persistence

Project data is stored where the team file says:

```toml
[server]
data_dir = "./data/project-a"

[images]
upload_dir = "./uploads/project-a"
```

Important files in `data_dir` include chat history, jobs, rules, roles,
settings, summaries, session runs, and agent queue files.

If you change settings in the UI, those runtime settings are saved under the
project `data_dir` and can override defaults from the team file on the next
startup.

## Troubleshooting

List project sessions:

```bash
tmux list-sessions | grep agentchattr-project-a
```

View server output:

```bash
./ac project-a logs server
```

If the server crashes before its tmux session stays alive, inspect the persisted
server log instead:

```bash
tail -n 120 data/project-a/server.log
```

View wrapper output:

```bash
./ac project-a logs wrapper:claude-planner
```

View live agent:

```bash
./ac project-a attach claude-planner
```

Check if ports are already taken:

```bash
lsof -i :8301
lsof -i :8211
lsof -i :8212
```

If `./ac project-a up` says a port is already listening, either stop the other
process or change the project’s ports.

## Docker Notes

The current `./ac` workflow is host/tmux based. Docker is intentionally
postponed until the runner/preflight path is stable. When Docker work resumes,
mount persistent directories for:

```text
data_dir
upload_dir
project source repo
agent credentials, if needed
```

Without mounted volumes or bind mounts, container-local state should be treated
as disposable.
