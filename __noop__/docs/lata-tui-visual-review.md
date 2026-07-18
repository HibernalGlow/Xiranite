# Lata TUI visual review

## Sources

- GUI/reference comparison: `output/playwright/lata/lata-reference-review.jpg`
- GUI implementation: `src/nodes/lata/Component.tsx`
- TUI capture: `artifacts/cli/lata/taskfile-session.png`

## Reproduction decisions

- The workbench preserves Taskfile config, task list, terminal session, and
  execution metrics.
- List and preview are one-click safe commands. Execute reaches destructive
  confirmation because Taskfile commands may perform arbitrary host changes.
- Taskfile, cwd, task, and arguments remain directly editable. Planned commands
  are displayed in dependency order with stdout, stderr, and exit codes.
- A Unicode shell-cursor animation identifies active command execution.
- Tests inject command results and never execute real Taskfile commands.

## Automated evidence

```powershell
bun run --cwd packages/nodes/lata build
bun run --cwd packages/nodes/lata test
bun test packages/nodes/lata/src/Tui.bun.test.tsx
node --experimental-strip-types scripts/capture-cli-ui.ts --node lata --cli packages/nodes/lata/src/cli.ts --case taskfile-session --wait "LATA // TASKFILE SESSION"
```
