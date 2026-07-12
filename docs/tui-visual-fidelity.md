# TUI visual fidelity reviews

Each migrated node must be reviewed against its GUI reference image after a
real OpenTUI PNG capture. Character snapshots remain useful for assertions but
do not replace this review.

## TimeU

- GUI evidence: `output/playwright/timeu/timeu-reference-review.jpg`
- OpenTUI evidence: `artifacts/cli/timeu/timestamp-ledger.png`
- Capture: 128 columns by 32 rows, Chinese, Nord fallback theme.

The terminal workbench preserves the GUI's primary hierarchy: scan/backup/
restore actions at the top, paths beside a dominant timestamp ledger, and a
guarded execution area after the data surface. Record and log tabs remain next
to execution rather than becoming a separate navigation screen.

The deliberate terminal adaptation is the lower safety strip. The GUI's narrow
right-hand control column becomes a horizontal row of recursion, directory,
and dry-run controls so the ledger keeps most of the available width. The
shared reset, exit, help, and task-queue actions stay in the global top chrome.

At narrower terminal widths the path queue and ledger share the flexible main
row while the safety strip remains below them. The evidence capture uses a
viewport sized to the 128-column terminal so browser canvas whitespace does not
misrepresent the layout.
