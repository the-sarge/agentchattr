# agentchattr Project Plan

This plan covers the project/team runner workflow, multi-project operations,
frontend improvements, and follow-on hardening work.

## Goals

- Make repeatable project-specific agent rosters easy to define and launch.
- Support multiple agentchattr projects running at the same time.
- Make agent operations visible enough that hung agents are easy to identify
  and recover.
- Keep the existing FastAPI/MCP/static-frontend architecture intact while the
  workflow is still evolving.

## Non-Goals

- Rewriting the core server in another language.
- Replacing the browser UI with a frontend framework.
- Making Docker the default runtime before the host/tmux workflow stabilizes.
- Solving every agent CLI authentication model in containers.

## Current Baseline

Implemented:

- `./ac <project> up/status/attach/down`
- team TOML config overlays via `AGENTCHATTR_PROJECT_CONFIG`
- project-specific tmux prefixes via `AGENTCHATTR_TMUX_PREFIX`
- provider aliases such as `provider = "claude"` for custom handles
- config-seeded roles
- detached wrapper startup for multi-agent launches
- loop guard max/default increased to `100`
- example team file at `teams/project-a.toml.example`
- operating guide at `TEAM_RUNNER_GUIDE.md`

Validated:

- single-project Docker smoke test with fake agents
- two simultaneous Docker project smoke test on separate ports
- project isolation for roles, labels, colors, tmux sessions, and shutdown

## Phase 1: Stabilize Team Runner

Objective: make `./ac` reliable enough for daily use.

Deliverables:

- Add `./ac <project> restart <agent>` for a one-agent reset.
- Add `./ac <project> logs <target>` for server/wrapper/agent pane capture.
- Add `./ac <project> list` or top-level `./ac list` to show known team files.
- Improve `up` preflight checks:
  - duplicate ports across team files
  - missing commands on `PATH`
  - duplicate agent names in a team file
  - missing or reused `tmux_prefix`
- Add clearer failure messages when server startup fails.
- Add a dry-run mode:
  ```bash
  ./ac project-a up --dry-run
  ```

Acceptance criteria:

- A stopped agent can be restarted without stopping the project.
- `status` clearly identifies server, wrapper, and live agent sessions.
- `up --dry-run` shows exact tmux sessions, ports, commands, and data paths.
- Project A can be stopped or restarted without affecting Project B.

## Phase 2: Team Config Polish

Objective: make team TOML files expressive but predictable.

Deliverables:

- Define and document a stable team TOML schema.
- Add schema validation with actionable errors.
- Add support for shared defaults:
  ```toml
  [agent_defaults.claude]
  cwd = ".."
  color = "#da7756"
  ```
- Add per-agent pass-through args:
  ```toml
  args = ["--dangerously-skip-permissions"]
  ```
- Add optional project title seeding so browser tabs are distinguishable.
- Add team file examples:
  - small two-agent project
  - larger Claude/Codex/Gemini team
  - API-agent project

Acceptance criteria:

- Invalid team files fail before starting any tmux sessions.
- Repeated provider config is minimized.
- Examples can be copied and started with only port/path changes.

## Phase 3: Agent Operations UI

Objective: surface the operational state that currently requires tmux/manual
inspection.

Deliverables:

- Add an Agent Operations panel in the UI.
- Show for each configured agent:
  - handle
  - label
  - provider
  - role
  - color
  - online/offline/busy state
  - last heartbeat age
  - tmux session name
  - attach command
- Show configured-vs-running mismatches:
  - configured but not registered
  - registered but not in team file
  - wrapper active but no live agent heartbeat
- Add copy buttons for attach commands.
- Add status badges for server, MCP HTTP, MCP SSE, and loop guard.

Acceptance criteria:

- From the browser, a user can identify the correct tmux session for a hung
  agent without reading docs.
- The UI distinguishes live agent sessions from wrapper supervisor sessions.
- Missing agents are visible as warnings, not silent absence.

## Phase 4: Project Awareness In The UI

Objective: make simultaneous browser tabs for Project A/B/C hard to confuse.

Deliverables:

- Show project name in the header.
- Show port and data directory in a Project settings view.
- Show team file path when launched with `AGENTCHATTR_PROJECT_CONFIG`.
- Add project accent color or short project badge.
- Add browser document title format:
  ```text
  project-a - agentchattr
  ```

Acceptance criteria:

- Multiple browser tabs are visually distinguishable.
- A user can confirm which project/server they are looking at from the UI.

## Phase 5: Frontend Maintainability

Objective: reduce risk when adding UI features.

Deliverables:

- Continue extracting large `static/chat.js` sections into modules:
  - settings
  - schedules
  - pins/todos
  - attachments/images
  - message rendering
  - help tour
- Keep `Hub` and `Store` as transition helpers until the module boundary is
  cleaner.
- Avoid adding new major features directly to `chat.js`.

Acceptance criteria:

- New Agent Operations UI lives outside `chat.js`.
- Existing behavior is preserved after each extraction.
- Frontend modules have clear ownership boundaries.

## Phase 6: Search And Navigation

Objective: make long-running project chats easier to operate.

Deliverables:

- Add server-backed message search over project history.
- Add filters:
  - sender
  - channel
  - pinned/todo/done
  - jobs/session/system messages
- Add a command palette:
  - switch channel
  - open jobs
  - open rules
  - open Agent Operations
  - copy attach command
  - continue loop guard
- Add keyboard-driven access with `Cmd/Ctrl+K`.

Acceptance criteria:

- Users can find an old decision or agent output without scrolling.
- Common operations are accessible from keyboard-driven navigation.

## Phase 7: Docker Option

Objective: evaluate containerized project instances after the host workflow is
stable.

Recommended model:

- one container per project
- server and wrappers in the same container
- persistent mounts for:
  - project source repo
  - `data_dir`
  - `upload_dir`
  - agent credentials, where needed

Deliverables:

- Add optional Dockerfile.
- Add `./ac <project> up --docker` prototype.
- Add documented volume layout.
- Add fake-agent Docker CI smoke test for:
  - single project
  - multiple projects
  - shutdown cleanup

Acceptance criteria:

- Container removal does not delete project data when volumes are mounted.
- Docker mode does not become required for normal host/tmux usage.
- Credentials and project source mounts are explicit.

## Phase 8: Packaging Later

Objective: make installation cleaner after command shape stabilizes.

Options:

- keep `./ac` as the repo-local script
- add a Taskfile as a thin wrapper around `./ac`
- later add a Python console entry point or Go binary

Recommendation:

- Keep `./ac` for now.
- Reconsider packaging once the command set has settled.
- Consider a Go rewrite only for the runner if the Python script becomes a
  stable, widely used CLI.

## Testing Strategy

Unit tests:

- config overlay behavior
- provider alias defaults
- team schema validation
- command planning/dry-run output

Smoke tests:

- fake agents in Docker
- one project up/down
- two projects simultaneously
- project A down while project B remains running
- seeded roles visible through API
- status output contains expected tmux sessions

Manual tests:

- real Claude/Codex/Gemini launch
- attach/detach behavior
- hung-agent recovery
- browser UI operations panel

## Risks

- Agent CLIs have different auth and MCP configuration expectations.
- tmux session cleanup can be too broad if prefixes are poorly chosen.
- UI settings stored under `data_dir` can override team-file defaults.
- Running many agents can make port/session/name collisions more likely.
- Dockerizing real agent CLIs may require significant credential and toolchain
  setup.

## Near-Term Recommended Sequence

1. Add `restart` and `logs` to `./ac`.
2. Add team TOML validation and `up --dry-run`.
3. Add Agent Operations UI with attach commands.
4. Add project name/team file awareness to the UI.
5. Extract settings/schedules from `chat.js` before adding larger UI features.
6. Revisit Docker once the host-based team runner feels stable.

## Parallel Subagent Handoff

Use this section after restarting context. The tasks below are intentionally
split by ownership boundary so several subagents can work at the same time
with minimal file conflicts.

### Coordination Rules

- Keep each subagent on a disjoint write set.
- Tell worker subagents they are not alone in the codebase and must not revert
  edits made by others.
- Avoid multiple workers editing `ac` at the same time.
- Avoid editing `static/chat.js` unless the task explicitly requires a tiny
  integration hook.
- Prefer new focused modules for frontend work.
- Main thread should own final integration and conflict resolution.

### Parallel Batch 1

Recommended first batch after context restart:

1. Runner commands worker
2. Team TOML validation worker
3. Agent Operations UI explorer/worker
4. Docs/examples worker

The main thread should define/confirm any API contract needed by the UI while
the workers handle their bounded slices.

### Worker A: Runner Commands

Ownership:

- `ac`
- new or existing runner-focused tests
- small README/guide updates only for commands this worker adds

Task:

- Add `./ac <project> restart <agent>`.
- Add `./ac <project> logs <target>`.
- Add `./ac <project> list` or top-level listing if practical.
- Add `./ac <project> up --dry-run`.
- Keep session naming consistent:
  - `{tmux_prefix}-server`
  - `{tmux_prefix}-<agent>`
  - `{tmux_prefix}-wrap-<agent>`

Acceptance criteria:

- Restart one agent without stopping the whole project.
- Logs command can capture server, wrapper, or live agent panes.
- Dry run prints planned ports, data paths, team file, server session, wrapper
  sessions, live agent sessions, and commands without starting tmux sessions.
- Existing `up/status/attach/down` behavior remains intact.

Suggested subagent prompt:

```text
You are Worker A for agentchattr. Implement runner command enhancements in `ac`.
You are not alone in the codebase; do not revert edits made by others. Own only
`ac` plus runner-specific tests/docs needed for your commands. Add
`restart <agent>`, `logs <target>`, `list` if practical, and `up --dry-run`.
Preserve the tmux naming convention and existing behavior. Run syntax checks
and relevant tests. In your final response, list files changed and verification.
```

### Worker B: Team TOML Validation

Ownership:

- `config_loader.py`
- validation helper module if needed
- config/team tests
- team example files only if validation requires a schema adjustment

Task:

- Define validation for team/project config overlays.
- Validate before startup where possible.
- Catch:
  - no agents
  - duplicate or missing ports
  - missing `tmux_prefix`
  - invalid agent names
  - missing provider/command
  - unknown providers
  - invalid color strings
  - role strings over the UI-supported length
- Produce actionable error messages.

Acceptance criteria:

- Invalid team files fail before starting tmux sessions.
- Valid existing examples still load.
- Tests cover valid config, missing agents, bad ports, bad provider, bad color,
  and provider alias command inference.

Suggested subagent prompt:

```text
You are Worker B for agentchattr. Implement team TOML validation. You are not
alone in the codebase; do not revert edits made by others. Own
`config_loader.py`, optional validation helpers, and config tests. Invalid team
configs should fail with actionable errors before orchestration starts where
possible. Preserve existing config.toml/config.local.toml behavior. Run relevant
tests. In your final response, list files changed and verification.
```

### Worker C: Agent Operations UI

Ownership:

- new `static/agent-ops.js`
- optional new `static/agent-ops.css`
- minimal `static/index.html` hook
- avoid large edits to `static/chat.js`

Task:

- Add an Agent Operations panel.
- Show each configured/running agent with:
  - handle
  - label
  - provider if available
  - role
  - color
  - online/offline/busy state
  - tmux session name or attach command if available
- Add copy buttons for attach commands.
- Show warnings for configured but not running and running but not configured
  if the backend data is available.

Acceptance criteria:

- UI can be opened from the header.
- Agent rows render from current available status data.
- Attach commands follow `./ac <project> attach <agent>`.
- No major feature code is added to `static/chat.js`.

Suggested subagent prompt:

```text
You are Worker C for agentchattr. Add an Agent Operations frontend panel. You
are not alone in the codebase; do not revert edits made by others. Own new
`static/agent-ops.js`, optional CSS, and minimal `static/index.html` integration.
Avoid large edits to `static/chat.js`. Use current status/role/agent data where
available, and structure the module so richer backend project metadata can be
added later. In your final response, list files changed and verification.
```

### Worker D: Docs And Examples

Ownership:

- `TEAM_RUNNER_GUIDE.md`
- `PROJECT_PLAN.md`
- `README.md`
- `teams/*.toml.example`

Task:

- Add more team examples:
  - small two-agent project
  - large Claude/Codex/Gemini roster
  - API-agent project
- Tighten troubleshooting docs.
- Add command examples for any new runner commands implemented by Worker A.
- Keep docs aligned with actual command behavior.

Acceptance criteria:

- A new user can copy an example team file and understand which ports/paths to
  change.
- Docs clearly distinguish live agent sessions from wrapper sessions.
- Docs do not describe unimplemented commands unless marked as planned.

Suggested subagent prompt:

```text
You are Worker D for agentchattr. Improve docs and examples for the team runner.
You are not alone in the codebase; do not revert edits made by others. Own
`TEAM_RUNNER_GUIDE.md`, `PROJECT_PLAN.md`, `README.md`, and `teams/*.toml.example`.
Add practical examples and troubleshooting. Do not document commands as
available unless they are implemented. In your final response, list files
changed and verification.
```

### Main Thread Integration Tasks

Main thread should own:

- Choosing final API shape for project/team metadata.
- Reviewing `ac` command behavior for compatibility.
- Running full local tests and Docker smoke tests.
- Resolving conflicts if workers touch shared docs.
- Deciding whether Agent Operations needs a backend API before merging.

### Avoid Parallelizing

- Multiple workers editing `ac` concurrently.
- Frontend extraction from `static/chat.js` while Agent Operations UI is being
  added.
- Core MCP/routing changes unless scoped to a small bug fix.
