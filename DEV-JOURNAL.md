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
