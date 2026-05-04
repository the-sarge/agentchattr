# agentchattr Team Runner Guide

This guide covers the project/team workflow driven by `./ac`.

The goal is to define a repeatable roster per project, then start, inspect,
attach to, and stop that project without manually renaming agents in the UI.

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
cp teams/project-a.toml.example teams/project-a.toml
```

Edit ports, paths, and agents as needed, then start it:

```bash
./ac project-a up
```

Check status:

```bash
./ac project-a status
```

Attach to an agent:

```bash
./ac project-a attach claude-planner
```

Stop the project:

```bash
./ac project-a down
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
tmux_prefix = "agentchattr-project-a"

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

[agents.claude-planner]
provider = "claude"
cwd = ".."
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

## Restarting One Agent

There is not yet a dedicated `./ac project-a restart <agent>` command. For now:

1. Kill the live agent tmux session.
2. Wait a few seconds for its wrapper to exit.
3. Run `./ac project-a up` again. Existing sessions are left alone; stopped
   wrappers are started again.

Example:

```bash
tmux kill-session -t agentchattr-project-a-claude-planner
sleep 5
./ac project-a up
```

If the wrapper session is still present and stuck, kill it too:

```bash
tmux kill-session -t agentchattr-project-a-wrap-claude-planner
./ac project-a up
```

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
./ac project-a attach server
```

View wrapper output:

```bash
./ac project-a attach wrapper:claude-planner
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

The current `./ac` workflow is host/tmux based. Docker can work later, but if
you put server and agents in a container, mount persistent directories for:

```text
data_dir
upload_dir
project source repo
agent credentials, if needed
```

Without mounted volumes or bind mounts, container-local state should be treated
as disposable.
