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

## SmartZip

- GUI evidence: `output/playwright/smartzip/smartzip-reference-review.jpg`
- OpenTUI evidence: `artifacts/cli/smartzip/operation-chamber.png`
- Capture: 128 columns by 32 rows, Chinese, Nord fallback theme.

The terminal composition keeps SmartZip's reference workflow intact: a path
queue on the left, a dominant `Operation chamber` command plan beside it, and
a clearly isolated execution configuration area. Action tabs stay immediately
above the two primary surfaces, with the same status, extract, codepage,
open, archive, and settings paths as the GUI.

The GUI's tall right-hand configuration column is intentionally converted into
a bottom drawer. This lets the command plan remain readable at terminal width
while retaining editable INI, run-record, executable, AutoHotkey, dry-run,
and execution controls in the same fullscreen view. The drawer is explicitly
validated in the 32-row PNG so no editable field is clipped.

## Gifu

- GUI evidence: `output/playwright/gifu/gifu-reference-review.jpg`
- OpenTUI evidence: `artifacts/cli/gifu/sequence-lab.png`
- Capture: 128 columns by 32 rows, Chinese, Nord fallback theme.

The terminal view preserves the source-to-sequence workflow: archive input is
anchored left, the animated sequence preview is the central work surface, and
format/output controls plus the compile action form the lower deck. The GUI's
format codec, output target, quality timing, and safe-generation intent remain
visible without changing to a guided sequence.

## BitV

- GUI evidence: `output/playwright/bitv/bitv-reference-review.jpg`
- OpenTUI evidence: `artifacts/cli/bitv/analysis-lab.png`

The analysis workbench keeps a source rail, dominant bitrate-analysis surface,
and the lower classification control strip. Its evidence capture confirms the
large results surface remains the visual priority.

## SoundW

- GUI evidence: `output/playwright/soundw/soundw-reference-review.jpg`
- OpenTUI evidence: `artifacts/cli/soundw/recording-route.png`

The terminal layout retains the device matrix, profile-card region, CLI-path
override, and action console as separate usable surfaces.

## RepackU

- GUI evidence: `output/playwright/repacku/repacku-reference-review.jpg`
- OpenTUI evidence: `artifacts/cli/repacku/packing-workbench.png`
- Capture: 128 columns by 32 rows, Chinese, Nord fallback theme.

The terminal composition follows the GUI's folder-matrix workflow: a left path
matrix, a flexible central repack plan, and a lower configuration/safety deck.
The GUI's right-side pack configuration is intentionally flattened into the
lower deck so the plan remains readable in a character-cell viewport. Action
tabs expose analyze, full flow, compress, single-pack, and gallery-pack without
turning the workbench into a guided wizard.

The PNG was reviewed against the reference after rebuilding the shared runtime;
numeric controls use the portable `∷` semantic icon rather than `#`, and the
shared reset/exit/help/task-queue chrome remains in the top row.

## ClassF

- GUI evidence: `output/playwright/classf/classf-reference-review.jpg`
- OpenTUI evidence: `artifacts/cli/classf/transfer-control.png`
- Capture: 128 columns by 32 rows, Chinese, Nord fallback theme.

ClassF uses a source-list rail and a dominant classification-plan surface, with
transfer mode, classify mode, existing-item policy, target directory, and dry
run controls in a lower execution deck. This keeps the GUI's matrix/transfer
relationship visible without copying its three-column browser layout.

## FormatV

- GUI evidence: `output/playwright/formatv/formatv-reference-review.jpg`
- OpenTUI evidence: `artifacts/cli/formatv/media-format-lab.png`
- Capture: 128 columns by 32 rows, Chinese, Nord fallback theme.

FormatV uses a video-source rail and a dominant format-check/rename-plan
surface. Scan, add, remove, and duplicate actions remain visible as tabs; the
lower deck keeps prefix, report, recursion, and dry-run controls editable while
the execution button stays in a stable wide hit region.
