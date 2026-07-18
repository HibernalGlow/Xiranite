# Recycleu Node UI Design Note

## Basic Judgment

Recycleu is a small but dangerous system utility. Its UI should be closer to a timer/status control than a form. The key information is whether cleaning is idle/running/completed/error, how long until the next clean, and how many times it has cleaned.

The node package remains headless. The app UI owns confirmation, countdown display, compact status, and desktop-only risk messaging.

## Core Tasks

1. Query current cleaner status.
2. Empty the recycle bin immediately.
3. Start interval-based auto-clean.
4. Display countdown progress.
5. Show clean count and last clean time.
6. Handle unsupported platform or backend failures.

## Common Path

```text
check status
-> set interval and optional drive
-> confirm clean/start
-> watch countdown and clean count
-> stop by ending the run or using host controls
```

## Dangerous Actions

- `clean_now` empties recycle bin content.
- `start` repeatedly empties recycle bin.
- A drive-specific clean may still surprise users if the drive field is wrong.

Danger strategy:

- Require confirmation before `clean_now` and `start`.
- Confirmation must show interval, max cycles, drive target, and irreversible risk.
- Use clear destructive styling for immediate clean.
- Keep status visible even in collapsed mode.

## Preview Data

Recycleu does not need a table. It needs a status display:

- timer status
- remaining seconds
- interval
- max cycles
- drive letter
- clean count
- last clean time
- latest log message

The best preview is a countdown ring or compact progress meter paired with a small stats row.

## Runtime Focus

During a run, the user needs:

- remaining seconds until next clean
- clean count
- latest clean message
- current timer status
- progress percent
- error state if unsupported

## Success Next Step

- After status: decide whether to clean now or start timer.
- After clean now: inspect last clean time and copy logs if needed.
- After auto-clean: review clean count and completion state.

## Failure Help

- Show unsupported platform or backend error in the main status area.
- Do not bury failure only in logs.
- Keep interval and drive inputs visible so the user can adjust and retry.

## Surface Layout

### Collapsed

Show:

- Recycleu icon
- timer status
- remaining seconds or clean count
- compact clean/start action

If running, show a subtle progress/countdown indicator.

### Compact

Show:

- countdown/status block
- interval and drive controls
- clean now and start buttons
- latest log line

Low-frequency max cycles can live in a popover.

### Portrait

Show:

- large countdown/status block
- controls below it
- log/status history tab at the bottom

The timer is the hero of this surface, not the form.

### Regular

Use two zones:

- left: timer status, count, last clean
- right: interval, drive, max cycles, actions, logs

### Expanded / Workspace

Use:

- top status strip with timer state and latest message
- main countdown/progress panel
- settings panel for interval, max cycles, drive
- logs below or beside the timer

No long scrolling should be required for the common flow.

## Component Choices

Use:

- shadcn Button, Badge, AlertDialog, Popover, Tooltip, Progress
- compact stat cards
- a lightweight countdown/progress ring built locally if no project component exists

Do not use:

- table UI
- raw log-first layout
- always-visible advanced settings
- silent destructive actions

## Split Points

Recommended structure:

```text
src/nodes/recycleu/
  Component.tsx
  controls.tsx
  CountdownStatus.tsx
  ResultPanels.tsx
  types.ts
  Component.test.tsx
```

`CountdownStatus.tsx` owns the timer presentation. `controls.tsx` owns interval/drive/max-cycle inputs. `Component.tsx` owns run state and surface branching.

## Tests

Package:

- `bun --filter @xiranite/node-recycleu test`
- `bun --filter @xiranite/node-recycleu build`

App:

- surface matrix for all modes
- confirmation before clean now
- confirmation before start
- countdown/progress event rendering
- unsupported backend/platform error
- compact short-height collapsed branch
- default config save/restore if config controls exist

QA:

```bash
bun run qa:card -- recycleu matrix --screenshot
```

Acceptance:

- destructive actions require confirmation
- countdown and clean count remain visible while running
- compact view is not a tall settings form
- failure state is visible without opening logs
