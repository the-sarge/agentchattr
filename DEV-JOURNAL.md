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
