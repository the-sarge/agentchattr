# DEV-JOURNAL

**Append-only. New entries go at the END of this file.**

This journal records project sessions, decisions, implementation milestones,
commits, open questions, and recommended next steps.

## Entry Template

```markdown
---

## YYYY-MM-DD HH:MM TZ - Session Title

**Branch:** `branch-name`
**Base Commit:** `short-sha`
**Commits:** none

### Summary

### Decisions

### Changes

### Verification

### Open Questions

### Next Steps
```

---

## 2026-05-04 16:33 EDT - Team Runner And Multi-Project Workflow

**Branch:** `main`
**Base Commit:** `0440f5d`
**Commits:** none

### Summary

Set up this fork for project-specific experimentation and built the first pass
of a repeatable team runner workflow. The main outcome is a repo-local `./ac`
script that can start, inspect, attach to, and stop project-specific
agentchattr teams from TOML files.

### Decisions

- Keep normal pushes pointed at `the-sarge/agentchattr`; disable accidental
  pushes to upstream by setting `upstream` push URL to `DISABLED`.
- Use `./ac` as the near-term runner instead of Task or an installed CLI.
- Keep orchestration in Python for now; consider a Go runner only after the
  command shape stabilizes.
- Keep the default runtime host/tmux based for now.
- Treat Docker as a later optional mode, likely one container per project with
  server and wrappers together plus mounted persistent data.
- Use predictable tmux names:
  - `{tmux_prefix}-server`
  - `{tmux_prefix}-<agent>`
  - `{tmux_prefix}-wrap-<agent>`
- Use project/team TOML files as the source of truth for agent rosters.
- Add a project-local `DEV-JOURNAL.md` for timestamped session handoffs.

### Changes

- Changed loop guard limits from `50` to `100` in the settings UI and backend
  validation.
- Changed default `routing.max_agent_hops` in `config.toml` to `100`.
- Added project config overlay support through `AGENTCHATTR_PROJECT_CONFIG`.
- Added provider aliases so custom handles can use built-in provider behavior,
  for example `provider = "claude"` with `[agents.architect]`.
- Added config-seeded roles so team TOML `role = "Planner"` is reflected in
  runtime role state.
- Added detached/namespaced tmux support to wrapper startup.
- Added executable `./ac` with:
  - `up`
  - `status`
  - `attach`
  - `down`
- Added example team file at `teams/project-a.toml.example`.
- Added `TEAM_RUNNER_GUIDE.md` as the operator reference.
- Added `PROJECT_PLAN.md` with phases, risks, testing strategy, and a
  parallel subagent handoff plan.
- Updated README references for the project team workflow, guide, and roadmap.

### Verification

- Ran syntax checks for touched Python files, including `ac`.
- Ran dependency-light unit tests locally; latest relevant run passed `29`
  tests.
- Ran full tests inside Docker after installing dependencies; Docker run passed
  `46` tests.
- Ran Docker smoke test with fake `claude`, `codex`, and `gemini` commands for
  one project.
- Ran Docker smoke test with two simultaneous projects on separate ports,
  overlapping agent handles, separate roles/colors/labels, and independent
  shutdown.

### Open Questions

- Whether to add `restart`, `logs`, `list`, and `up --dry-run` to `./ac` next.
- What exact backend API shape the Agent Operations UI should consume.
- Whether team TOML validation should live entirely in `config_loader.py` or in
  a dedicated helper module.
- Whether Docker mode should be implemented as `./ac <project> up --docker`
  after the host/tmux workflow stabilizes.
- Whether the runner should eventually become an installed CLI or remain a
  repo-local script.

### Next Steps

1. Add `./ac <project> restart <agent>` and `./ac <project> logs <target>`.
2. Add team TOML validation and `./ac <project> up --dry-run`.
3. Add an Agent Operations panel in the frontend with attach commands and
   configured-vs-running warnings.
4. Add project awareness to the UI header so simultaneous project tabs are easy
   to distinguish.
5. Use the `PROJECT_PLAN.md` parallel subagent handoff section to split work
   across workers in the next session.

---

## 2026-05-04 23:51 EDT - Phase 6 Search Navigation

**Branch:** `feature/phase-6-search-nav`
**Base Commit:** `cad5665`
**Commits:** `9e5b532`

### Summary

Finished the remaining Phase 6 search and navigation work on top of the
project runner and Agent Operations baseline. The main outcome is a
server-backed command palette that searches project message history instead of
only the currently loaded browser slice.

### Decisions

- Keep plain search scoped to message body text so channel names and result
  descriptions do not create noisy false positives.
- Keep sender search explicit with `@sender`, while leaving normal username
  matching out of plain search for now.
- Prefer channel switch commands ahead of message matches when the query
  matches a channel name.
- Add `[project].username` directly under `title` in team/project TOML as a
  startup seed for fresh projects, with saved UI settings taking precedence.
- Keep the Agent Operations payload unchanged and reorder only the rendered
  panel sections.

### Changes

- Added `GET /api/search` and `MessageStore.search()` for history-backed
  message search.
- Added server-side filters for sender, channel, pinned, todo, done, jobs,
  sessions, and system messages.
- Updated `static/search-nav.js` to use the search API, debounce queries,
  show status text, highlight matched snippets, and support Home/End/Page
  keyboard navigation.
- Updated search filters to use backend facets so sender/channel dropdowns are
  not limited to the currently visible result set.
- Reordered Agent Operations sections to show Warnings, Running Agents, then
  Configured Agents.
- Added `[project].username` validation, settings seeding, examples, and
  README documentation.
- Updated `PROJECT_PLAN.md` and README language to reflect server-backed
  project-history search.
- Added focused tests for search semantics, project username seeding, and
  config validation.

### Verification

- Ran `.venv/bin/python -m pytest -q`; latest run passed `66` tests.
- Ran `node --check static/search-nav.js`.
- Ran `node --check static/agent-ops.js`.
- Ran `.venv/bin/python -m py_compile app.py config_loader.py`.
- Ran `git diff --cached --check` before committing `9e5b532`.
- Smoke-started a separate local server on `127.0.0.1:8310` with alternate MCP
  ports to avoid disturbing the existing `8300` project server.

### Open Questions

- Search can find older messages from the full store, but jumping to a result
  still depends on whether that message is present in the current browser DOM.
  A future `/api/messages/window` endpoint could load a surrounding message
  window before scrolling.
- Broader Phase 5 frontend extraction remains open; this session kept new
  search and operations behavior outside the `chat.js` monolith where possible.

### Next Steps

1. Open a PR for `feature/phase-6-search-nav` against `the-sarge/agentchattr`.
2. Browser-test long-history search with realistic project data and channel
   switches.
3. Decide whether old-result navigation needs a message-window loader before
   considering Phase 6 fully polished.
4. Continue Phase 5 extraction in smaller frontend-only follow-up branches.

---

## 2026-05-05 19:38 EDT - Phase 5 Frontend Maintainability Closeout

**Branch:** `main`
**Base Commit:** `33b7dcd`
**Commits:** `6b2e346`, `7514a42`, `a30186b`, `5feb9d6`, `01696ff`, `51764d3`, `edab142`, `3da9642`, `012a2ba`

### Summary

Finished the planned Phase 5 frontend maintainability pass after Phase 6 had
already landed. The main outcome is that the largest `static/chat.js` feature
areas listed in `PROJECT_PLAN.md` now live in focused frontend modules, with
the remaining bridge surface made more observable where extraction introduced
new module boundaries.

### Decisions

- Keep `Hub`, `Store`, and `window.*` bridges as transition helpers rather
  than introducing a bundler or framework during this pass.
- Extract one behavior slice per branch and merge only after syntax checks,
  whitespace checks, and pytest passed.
- Preserve existing globals required by static HTML or already-rendered markup
  while shrinking new public surface where possible.
- Treat inline-handler hardening as part of Phase 5 closeout once the image
  modal and message/session renderer reviews surfaced the same escaping
  pattern.
- Keep the confused-agent local stack preserved on safety branches instead of
  deleting or wholesale-merging it.

### Changes

- Extracted settings into `static/settings.js`.
- Extracted pins and todos into `static/pins-todos.js`.
- Extracted schedules into `static/schedules.js`.
- Extracted attachments, composer image upload, previews, and shared image
  modal logic into `static/attachments.js`.
- Extracted help tour behavior into `static/help-tour.js` and reduced exposed
  help-tour internals before merge.
- Extracted timeline message rendering and per-channel date-divider state into
  `static/message-rendering.js`.
- Hardened image modal attachment handlers by replacing URL-bearing inline
  handlers with `data-image-modal-url` plus delegated click handling.
- Added canonical `window.escapeAttr` and moved message-rendering actions from
  inline handlers to delegated `data-message-action` handling.
- Moved generated session actions from inline handlers to delegated
  `data-session-action` handling with observable missing-attribute diagnostics.

### Verification

- Repeated `node --check` across `static/*.js` for each frontend PR.
- Ran `git diff --check` and `git diff --cached --check` before commits.
- Ran `.venv/bin/python -m pytest`; latest PR validations passed `66` tests.
- Used targeted `rg` checks to confirm the hardened image modal,
  message-rendering, and sessions paths no longer emit the reviewed inline
  handlers.
- Verified PR #13 merged cleanly and closed issue #11.

### Open Questions

- Static frontend behavior still has no dedicated JS test harness; these
  refactors rely on syntax checks, backend tests, targeted greps, review, and
  manual browser smoke testing.
- Old search-result navigation from Phase 6 still depends on the message being
  present in the current browser DOM; a future message-window endpoint could
  make that more robust.
- Two parked branches remain as safety refs for local-only confused-agent work:
  `feature/phase-5-stacked-extractions` and
  `safety/phase-5-stacked-20260505-034120`.

### Next Steps

1. Browser-smoke test message actions, session launcher flows, and image modal
   previews against realistic data.
2. Start Phase 7 Docker Option from a fresh branch on clean `main`.
3. Keep Docker optional and avoid disturbing the normal host/tmux workflow.

---

## 2026-05-06 00:23 EDT - Agent Operations Polish And Team Routing

**Branch:** `main`
**Base Commit:** `012a2ba`
**Commits:** `ca2126e`, `3b9eee5`, `c8d8cdc`, `070f9e1`, `5ef644b`, `1c5a01c`, `57baa6f`, `9ef8e64`

### Summary

Closed the remaining post-Phase-5 operational polish before starting the next
backend/runner slice. The main outcomes are a manual frontend smoke-test
checklist, clearer message identity affordances, corrected agent tmux attach
commands, markdown-code-safe mention routing, team-grouped agent listings, and
new `@team:<name>` / `@role:<name>` routing.

### Decisions

- Postpone Phase 7 Docker work until the host/tmux runner is more reliable and
  easier to inspect.
- Keep Docker optional when it resumes; do not make it a prerequisite for the
  normal project/team workflow.
- Treat team and role routing as server-side mention expansion rather than a
  frontend-only convenience.
- Use configured team metadata and runtime MCP role state as the routing
  sources of truth.
- Keep quoted inline code and fenced code inert for all mention forms,
  including `@agent`, `@all`, `@team:<name>`, and `@role:<name>`.

### Changes

- Added `FRONTEND_SMOKE_TEST_PLAN.md` for message actions, sessions,
  attachments, schedules, search, and command palette checks.
- Added tmux copy rows to the agent sidebar popover and fixed live attach
  session resolution so displayed commands match real tmux sessions.
- Added selectable dim message IDs in bubble headers and reply references.
- Fixed quoted/fenced-code mention parsing so documentation snippets do not
  wake agents.
- Added optional `team` metadata to configured and registered agents, surfaced
  it in API payloads, and sorted agent listings by team then label/name.
- Added `@team:<name>` routing and `@role:<name>` routing with punctuation
  boundaries, self-exclusion, loop-guard behavior, and observable sync failures
  in HTTP mutation paths.

### Verification

- User browser-smoke tested the frontend checklist successfully before noting
  the tmux attach and message-ID polish items.
- Ran targeted `node --check` validations for changed frontend modules during
  the frontend polish PRs.
- Ran `.venv/bin/python -m pytest`; latest PR validation passed `91` tests.
- Ran `python -m py_compile app.py router.py` for routing changes.
- Ran `git diff --check` before pushing reviewed PR updates.

### Open Questions

- `PROJECT_PLAN.md` still lists Phase 7 Docker as the next numbered phase, but
  we are intentionally postponing it until runner/preflight/config work is
  tighter.
- Some Phase 1 and Phase 2 runner/config items appear partially implemented in
  `./ac`, `config_loader.py`, README, and the team runner guide; the next PR
  should audit what is already real before adding more surface.
- The static frontend still has no dedicated JS harness; manual smoke tests
  remain the validation layer for browser-only flows.

### Next Steps

1. Build one focused PR for runner reliability, dry-run/preflight, and team
   config polish.
2. Update `PROJECT_PLAN.md` if the postponed Docker sequence becomes the new
   working order.
3. Keep future Docker design dependent on the runner's dry-run/preflight
   planner instead of inventing a separate launch model.

---

## 2026-05-06 00:59 EDT - Runner Config Polish Closeout

**Branch:** `main`
**Base Commit:** `c788b05`
**Commits:** `371ac63`

### Summary

Closed the runner/config polish slice that replaced the postponed Docker start.
The host/tmux runner now has a stronger preflight path, explicit `check`
command, persisted server logs, and tighter team schema validation around
labels, paths, and routable team/role metadata.

### Decisions

- Keep Phase 7 Docker postponed until the host runner's launch planning is
  reliable enough to reuse.
- Treat `./ac <project> check` as the operator-facing validation command, with
  `up --dry-run` reserved for printing the planned sessions, paths, ports, and
  commands.
- Persist server output under `data_dir/server.log` so startup crashes are
  diagnosable even if the tmux pane exits immediately.
- Keep team/role metadata constrained to values that round-trip cleanly through
  `@team:<name>` and `@role:<name>` routing.

### Changes

- Added `./ac <project> check`.
- Added path preflight for data/upload targets and agent `cwd` values.
- Wrapped missing/failing tmux starts with clear `SystemExit` messages.
- Updated server startup to tee output into `data_dir/server.log`.
- Tightened config validation for labels, duplicate effective labels after
  `[agent_defaults]`, `cwd`, and routable `role` / `team` values.
- Updated README, `TEAM_RUNNER_GUIDE.md`, and `PROJECT_PLAN.md` for the new
  runner/config order and postponed Docker status.

### Verification

- Ran `python -m py_compile config_loader.py ac`.
- Ran `.venv/bin/python -m pytest tests/test_ac_runner.py tests/test_config_schema.py`.
- Ran `.venv/bin/python -m pytest`; latest validation passed `102` tests.
- Ran `git diff --check`.
- Ran `./ac two-agent up --dry-run -f teams/two-agent.toml.example` and
  verified the planned server log path and command output.

### Open Questions

- The next UI pass should keep Agent Operations aligned with the runner's
  tmux/server/MCP model rather than inventing a second source of operational
  truth.
- Search-result navigation still needs to load the target message into the DOM
  when the result is outside the current visible history window.

### Next Steps

1. Document `@team:<name>` and `@role:<name>` in the user-facing routing docs.
2. Add Agent Operations status badges for server, MCP HTTP/SSE, and loop guard,
   plus clearer configured-vs-running warnings.
3. Harden search navigation so selecting old results loads the surrounding
   message window before scrolling.

---

## 2026-05-06 02:03 EDT - Ops Routing Search Polish Closeout

**Branch:** `main`
**Base Commit:** `93a7f0a`
**Commits:** `55a8566`

### Summary

Closed the post-runner polish slice that combined routing docs, Agent
Operations visibility, and long-history search navigation. The main outcome is
that users can route to teams/roles from documented syntax, inspect server/MCP
and loop-guard health from Agent Operations, and jump to older search results
even when the target message is not mounted in the current chat DOM.

### Decisions

- Keep `@team:<name>` and `@role:<name>` as documented routing syntax before
  adding autocomplete hints.
- Treat Agent Operations as the browser-visible view of the runner's tmux,
  server, MCP, loop-guard, and configured-vs-running state.
- Load older search results with a bounded server-side message window instead
  of forcing a full page reload or relying on current DOM presence.
- Make older-history navigation explicit with a visible banner and
  return-to-live action so live messages are not silently mixed into a frozen
  historical window.

### Changes

- Documented team and role routing in README, `TEAM_RUNNER_GUIDE.md`, and the
  frontend smoke checklist.
- Added Agent Operations service badges for Server, MCP HTTP, MCP SSE, and
  Loop Guard.
- Replaced flat mismatch text with clearer warning titles, details, and agent
  tags.
- Added `MessageStore.get_window_around()` and `GET /api/messages/window` for
  bounded history windows around search targets.
- Updated search-result activation to call a `navigateToMessage` bridge that
  switches channels, loads missing history windows, and highlights the target.
- Added an older-history banner with live-message waiting counts and a
  `Return to live` flow.
- Moved Agent Operations port probing off the event loop and tightened port
  probe diagnostics.
- Added request-level hardening follow-up coverage for bearer access to the
  message-window route.

### Verification

- Ran `node --check static/chat.js`.
- Ran `.venv/bin/python -m py_compile app.py`.
- Ran `git diff --check`.
- Ran `.venv/bin/python -m pytest tests/test_project_apis.py -q`; latest
  validation passed `22` tests plus `4` subtests.
- Ran `.venv/bin/python -m pytest -q`; latest validation passed `111` tests
  plus `4` subtests.

### Open Questions

- The static frontend still has no JS test harness, so the older-history banner
  and return-to-live behavior rely on syntax checks, backend/API tests, review,
  and manual smoke testing.
- Agent Operations now exposes useful status badges, but the runner CLI status
  output should stay aligned so terminal and browser diagnostics tell the same
  story.

### Next Steps

1. Browser-smoke test older search-result navigation, waiting live-message
   counts, and return-to-live behavior with realistic long-history data.
2. Keep request-level middleware coverage as the default for future bearer
   allowlist changes.
3. Move to the next runner/ops polish slice: one-agent restart, richer logs,
   and status output alignment with Agent Operations.

---

## 2026-05-06 02:37 EDT - Runner Ops Status And Logs Closeout

**Branch:** `main`
**Base Commit:** `52bd097`
**Commits:** `e73ae17`

### Summary

Closed the runner status/logs alignment slice. The `./ac` runner now reports
service and agent states in the same operational vocabulary as Agent
Operations, and `./ac <project> logs server` can read the persisted
`data_dir/server.log` even when the server tmux pane has already exited.

### Decisions

- Prefer persisted server logs for `logs server` so startup crashes remain
  diagnosable after tmux sessions disappear.
- Keep `./ac status` based on local tmux and port probes for now instead of
  requiring a live server API response.
- Treat `wrapper only` and `live only` as first-class CLI agent states because
  they point to different recovery actions.
- Keep richer heartbeat, busy, and registered-vs-configured details as future
  Agent Operations and runner convergence work.

### Changes

- Added runner helpers for server/MCP host lookup, probe-host normalization,
  host/port checks, persisted-log tailing, and service/agent state calculation.
- Updated `./ac <project> logs server` to read `data_dir/server.log` before
  falling back to tmux capture, including a clear empty-log message.
- Added a missing-live-session hint that points users to
  `./ac <project> logs wrapper:<agent>` when wrapper output is the useful path.
- Reworked `./ac <project> status` into Services, Agents, and Warnings sections
  with `running`, `listening`, `tmux only`, `wrapper only`, `live only`, and
  `stopped` states.
- Updated README, `TEAM_RUNNER_GUIDE.md`, and `PROJECT_PLAN.md` for persisted
  logs and the aligned status output.

### Verification

- Ran `python -m py_compile ac`.
- Ran `.venv/bin/python -m pytest tests/test_ac_runner.py -q`; latest validation
  passed `13` tests.
- Ran `.venv/bin/python -m pytest -q`; latest validation passed `115` tests
  plus `4` subtests.
- Ran `git diff --check`.

### Open Questions

- Whether `./ac status` should query `/api/agent-ops` when the server is
  listening so CLI output can include heartbeat, busy, and registered-vs-configured
  details.
- Whether `./ac logs` should eventually support an explicit source selection
  such as persisted, tmux, or both when those outputs diverge.
- Whether Agent Operations should surface `wrapper only` and `live only` as
  visible states instead of only mismatch warnings.

### Next Steps

1. Start the runner restart/recovery ergonomics PR.
2. Consider API-backed `./ac status` detail when the server is reachable.
3. Smoke test persisted server logs after a forced startup crash and status
   output with wrapper-only and live-only sessions.

---

## 2026-05-06 17:44 EDT - uv Runtime Migration Closeout

**Branch:** `main`
**Base Commit:** `f6962aa`
**Commits:** none

### Summary

Replaced the repo-local virtualenv launcher flow with a uv-only runtime model.
The source checkout now declares Python dependencies in `pyproject.toml` and
ships a `uv.lock`; `./ac`, team runner server/wrapper commands, and platform
launchers all run through `uv run`.

### Decisions

- Require uv instead of preserving a legacy `.venv` fallback because there are
  no existing users to preserve.
- Keep `./ac` as the user-facing command, with the Python runner moved to
  `ac.py` behind a tiny uv shim.
- Keep release artifacts source-checkout friendly by including `pyproject.toml`
  and `uv.lock`.
- Share launcher uv checks through platform-local helper files instead of
  copying the same block into every launcher.

### Changes

- Added `pyproject.toml` and `uv.lock`; removed `requirements.txt`.
- Replaced `./ac` with a uv-required shim and moved the runner implementation
  to `ac.py`.
- Updated `ac.py` dry-run, `up`, and `restart` paths to launch `run.py`,
  `wrapper.py`, and `wrapper_api.py` via `uv run --project`.
- Updated Mac/Linux launchers to source `macos-linux/common.sh` for uv checks.
- Updated Windows launchers to call `windows/common.bat` for uv checks.
- Updated README quickstarts with an explicit uv install step and changed
  manual commands from direct `python` to `uv run --project . python`.
- Updated release packaging to include uv project metadata and the new runner
  split.

### Verification

- Ran `./ac --help`.
- Ran `./ac list`.
- Ran `./ac -f teams/two-agent.toml.example two-agent up --dry-run`.
- Ran `uv run --project . python -c "import fastapi, uvicorn, mcp"`.
- Ran `uv run --project . python -m py_compile ac.py build_release.py config_loader.py`.
- Ran `sh -n macos-linux/*.sh`.
- Ran `uv run --project . python -m pytest tests/test_ac_runner.py -q`; latest
  validation passed `13` tests.
- Ran `uv run --project . python -m pytest -q`; latest validation passed
  `115` tests plus `4` subtests.
- Ran `git diff --check`.

### Open Questions

- uv still manages an environment under the hood. If the repo should never
  contain a `.venv` directory, set `UV_PROJECT_ENVIRONMENT` to a user-cache path
  in the runner and launchers.
- The full platform launcher matrix has syntax coverage for Mac/Linux, but
  Windows launchers still need a real Windows smoke test after this change.

### Next Steps

1. Smoke test one normal Mac/Linux launcher and one Windows launcher with uv
   installed from a clean checkout.
2. Decide whether to keep uv's default project environment location or force a
   cache-managed `UV_PROJECT_ENVIRONMENT`.
3. Continue runner recovery ergonomics: one-agent restart polish, richer logs,
   and possible API-backed `./ac status`.

---

## 2026-05-07 11:12 EDT - Go Runner Documentation Refresh

**Branch:** `main`
**Base Commit:** `a6316fc`
**Commits:** `a6316fc Add Go project runner`

### Summary

Refreshed project documentation after the `./ac` runner moved from the Python
uv shim to the Go/Cobra implementation. The docs now describe the current
runtime split: Go for the project runner, uv-managed Python for the server and
wrappers, and `./ac-python` as the temporary fallback.

### Decisions

- Treat the Go runner as the default `./ac` path.
- Keep release archives source-checkout friendly by packaging Go source and
  module files instead of a platform-specific `ac` binary.
- Keep `ac.py` and `./ac-python` documented as fallback until live smoke tests
  prove the Go runner in daily use.

### Changes

- Updated README wording for the Go/Cobra runner and first-run Go dependency
  fetch.
- Updated `TEAM_RUNNER_GUIDE.md` with current runner requirements and fallback
  path.
- Updated `PROJECT_PLAN.md` current baseline, packaging phase, and near-term
  sequence for the Go runner state.

### Verification

- Reviewed `README.md`, `PROJECT_PLAN.md`, `TEAM_RUNNER_GUIDE.md`, and
  `DEV-JOURNAL.md` for stale runner/runtime references.
- Ran `git diff --check`.

### Open Questions

- Whether future releases should include prebuilt `ac` binaries per platform or
  continue with source-only Go execution.
- When to remove `ac.py` and `./ac-python` after enough real runner smoke tests.

### Next Steps

1. Push `a6316fc`.
2. Run a real `./ac <project> up/status/logs/down` smoke test.
3. Run macOS/Linux and Windows launcher smoke tests.
