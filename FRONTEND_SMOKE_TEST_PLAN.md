# Frontend Smoke Test Plan

Use this checklist before starting Phase 7 or after frontend changes touching
message actions, attachments, sessions, schedules, or navigation.

## Setup

- [ ] Start the app normally and open the browser UI.
- [ ] Hard refresh the page.
- [ ] Open DevTools Console and keep it visible.
- [ ] Use a scratch channel or only disposable messages.
- [ ] Treat any new `MessageRendering: ...`, `Sessions: ...`, or
      `Attachments: ...` console error as a failure unless you intentionally
      broke a DOM attribute while testing.

## Message Actions

- [ ] Send a normal text message.
  - Expected: it appears immediately with a dim selectable message ID in the
    bubble header after the timestamp, with no console errors.

- [ ] Click `reply` on that message, type a reply, and send it.
  - Expected: reply preview appears, the sent message shows a reply quote, and
    both the preview and quote include the original message ID. Clicking the
    quote scrolls to and highlights the original.

- [ ] Click `del` on a disposable message.
  - Expected: delete mode opens and the clicked message's radio is already
    selected.
  - Then select one more message.
  - Expected: the count matches the selected radios.
  - Cancel once, then repeat and delete only disposable messages.

- [ ] Click the pin/todo button on a message through its states.
  - Expected: pin/todo/done visual state updates and the side panel reflects
    it.

- [ ] Click the role pill on a non-self agent message.
  - Expected: role picker opens, selecting a role updates the pill, with no
    console errors.

- [ ] Click `copy` on a message.
  - Expected: button shows copied state and clipboard gets the message content.

- [ ] Click `convert to job` on a disposable message.
  - Expected: job proposal/modal flow opens as before, and the hover button
    does not cover the message ID.

## Agent Sidebar

- [ ] Click an agent status pill in the sidebar/header.
  - Expected: the popup opens with rename, role, color, and tmux command copy
    rows below the color picker.

- [ ] Copy the live tmux command from that popup and attach to it in a terminal.
  - Expected: clipboard contains a working `tmux attach -t ...` command for
    the live agent session.

## Decision Cards

- [ ] If you have an agent or MCP client handy, create a decision card with:

  ```python
  chat_send(message="Smoke test decision?", choices=["Yes", "No", "Later"])
  ```

- [ ] Click one choice.
  - Expected: buttons fade/disable, the card updates to `You chose: ...`, with
    no console errors.

## Attachments And Image Modal

- [ ] Paste or drag an image into the composer.
  - Expected: preview appears and send button state updates.

- [ ] Click the composer image preview.
  - Expected: image modal opens.

- [ ] Send the image.
  - Expected: message renders with image attachment.

- [ ] Click the sent image.
  - Expected: modal opens, and next/previous controls behave correctly if
    multiple images exist.

## Sessions

- [ ] Click the session/play button near the composer.
  - Expected: session launcher opens.

- [ ] Click a built-in template.
  - Expected: cast preview opens.

- [ ] Change one cast dropdown.
  - Expected: matching roles sync where applicable, with no console errors.

- [ ] Click back, reopen a template, and close with `x`.
  - Expected: modal closes cleanly.

- [ ] Start a lightweight session only if you have a safe test roster running.
  - Expected: session banner appears and sticky session bar updates.

- [ ] If a session draft card is available, test `Run`, `Save Template`,
      `Request Changes`, and `Dismiss` on disposable data.
  - Expected: each action responds visibly, with no silent no-op.

## Schedules

- [ ] Open the schedule popover from the clock button.
  - Expected: popover opens and validation messaging appears normally.

- [ ] Create a short one-shot schedule with a disposable message.
  - Expected: schedule strip updates.

- [ ] Pause/resume/delete the schedule from the strip.
  - Expected: strip state updates without stale UI.

## Search And Command Palette

- [ ] Press `Cmd/Ctrl+K`.
  - Expected: command palette opens.

- [ ] Search for a recent message.
  - Expected: result appears and selecting it navigates/highlights when the
    message is in the current DOM.

## Failure Report

For any failure, record:

- Exact checklist item.
- What happened versus what was expected.
- Any console error text.
- Whether a browser refresh fixes it.
- Whether the issue reproduces consistently.
