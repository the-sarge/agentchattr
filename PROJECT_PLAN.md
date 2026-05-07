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

- uv-only Python runtime via `pyproject.toml` and `uv.lock`
- Go/Cobra `./ac` project runner
- `./ac-python` fallback for the previous Python runner in `ac.py`
- `./ac <project> up/status/attach/down/restart/logs/check`
- `./ac list`
- `./ac <project> up --dry-run`
- `./ac <project> status` output aligned with Agent Operations service and
  live/wrapper session states
- `./ac <project> logs server` reads persisted `data_dir/server.log` even if
  the server tmux pane has exited
- team TOML config overlays via `AGENTCHATTR_PROJECT_CONFIG`
- project-specific tmux prefixes via `AGENTCHATTR_TMUX_PREFIX`
- provider aliases such as `provider = "claude"` for custom handles
- shared `[agent_defaults.<provider>]`
- per-agent `args`
- config-seeded roles
- optional agent `team` metadata and `@team:<name>` routing
- `@role:<name>` routing
- detached wrapper startup for multi-agent launches
- runner preflight for duplicate ports/prefixes, missing commands, bad paths,
  and team schema issues
- release packaging for uv metadata, Go runner sources, launcher helpers, and
  the Python runner fallback
- persisted project server logs at `data_dir/server.log`
- loop guard max/default increased to `100`
- example team files for two-agent, large roster, API-agent, and project-a
- operating guide at `TEAM_RUNNER_GUIDE.md`
- Agent Operations UI with configured/running sections, attach command copy,
  server/MCP/loop-guard status badges, and clearer mismatch warnings
- project-aware UI metadata and document title
- server-backed search and command palette
- older search-result navigation that loads a bounded message-history window
  before scrolling, with a return-to-live affordance

Validated:

- single-project Docker smoke test with fake agents
- two simultaneous Docker project smoke test on separate ports
- project isolation for roles, labels, colors, tmux sessions, and shutdown
- runner/config validation with pytest coverage
- team/role routing with pytest coverage
- Agent Operations payload and search-window navigation API coverage

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

Status: postponed until the host/tmux runner, dry-run/preflight checks, and
team config schema are reliable enough to reuse as Docker's launch planner.

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

## Phase 8: Packaging And Distribution

Objective: make installation cleaner now that the command shape has stabilized
around a Go runner and uv-managed Python runtime.

Current status:

- `./ac` is the repo-local Go runner shim.
- Go source is included in release archives instead of committing a
  platform-specific binary.
- `./ac-python` remains available as a fallback while Go runner parity settles.
- Python runtime dependencies are locked with `uv.lock`.

Recommended next packaging work:

- Keep source-checkout execution as the default for now.
- Add platform-specific `ac` binaries to release artifacts only after real
  macOS/Linux and Windows smoke tests.
- Decide whether release archives should include both source and prebuilt
  binaries, or source only plus a documented `go build ./cmd/ac` step.
- Keep the Python fallback until the Go runner has covered live `up/status/logs`
  smoke tests in daily use.

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
- Go runner dry-run parity with the Python fallback
- Go runner unit tests
- uv-based Python runner regression tests

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

1. Push the current Go runner commit.
2. Run a real `./ac <project> up/status/logs/down` smoke test with at least one
   CLI agent.
3. Run one normal macOS/Linux platform launcher smoke test after the uv
   migration.
4. Run a Windows launcher smoke test.
5. Split `cmd/ac/main.go` into smaller packages once behavior parity is proven.
6. Revisit Docker only after the host-based Go runner feels stable.
