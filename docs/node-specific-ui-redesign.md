Before editing any node UI, back up the current node files in that node directory first.

# Node-specific UI redesign and PackU rewrite plan

This document is the implementation contract for redesigning the remaining Xiranite node frontends and removing Python-wrapper PackU nodes.

It supersedes ad-hoc node UI notes when they conflict on scope. `trename` is the only node currently allowed to remain largely as-is. Every other node, including nodes already touched by parallel work, must be treated as unfinished until it passes the function-specific UI and responsive acceptance checks below.

## Non-negotiable requirements

- Every node except `trename` must be rewritten or re-audited against this document. Existing partial rewrites are evidence to inspect, not completion proof.
- Before changing a node UI, create same-directory backups under `src/nodes/<node>/__backup__/` from the current committed version, for example `Component.before-ui-redesign.tsx` and `controls.before-ui-redesign.tsx`. Keep these backups committed with the redesign work so the old UI can be restored or compared later.
- Every rewritten node must keep `collapsed`, `compact`, `portrait`, and `full` layouts. Use the existing `useNodeSurface()` pattern and container queries.
- A larger card must not be a stretched version of the small card. It must expose a richer information architecture for that node's actual workflow.
- Do not use the generic "toolbar + input panel + result tabs" template as the final full layout.
- Keep dangerous operations gated by explicit confirmation. Icon-only buttons are acceptable for clear tools, not for destructive commits.
- Short mode sets use `ToggleGroup` / `ToggleGroupItem`, not dropdowns.
- Long content is locally scrollable. Primary action, current status, and risk controls remain visible.
- `Component.tsx` stays UI orchestration only. File system, shell, registry, network, and native execution remain in `platform.ts` or host runtime paths.
- Actively use or add higher-quality UI primitives when the existing shadcn primitives produce generic layouts. Prefer components that serve the node domain: data tables, file trees, timelines, command consoles, galleries, diff viewers, animated progress, and compact visual meters.
- Any new component must be checked into `src/components/ui/` or a node-local `parts/` folder with clear ownership. Avoid adding dependencies only for decoration.
- Existing user or parallel-model edits must be preserved unless they directly block the implementation.
- Section titles, module titles, tabs, metric labels, empty states, result panels, and recurring action controls must use clear icons when the icon improves scanability. Do not leave major panels as plain text headings.
- Icon usage must remain functional. Use familiar tool icons for actions such as run, stop, scan, filter, copy, export, delete, open, config, history, preview, table, gallery, tree, diff, timeline, and console. Do not invent decorative icons when the action is ambiguous.
- Color must be restrained and theme-aware. Prefer surface hierarchy from spacing, borders, type, and icons; use `bg-card`, `border`, and `text-muted-foreground` as the default structure. Avoid stacking many `bg-background/*` and `bg-muted/*` layers.
- Large gradients, radial blobs, and random accent washes are not allowed as default node backgrounds. Use accent color only for state, selection, risk, progress, and a small number of meaningful highlights.
- Do not replace a dense, efficient original UI with a lower-density redesign. A rewrite is accepted only when it improves task clarity, scan speed, or responsive behavior without burying primary controls.
- Labels should use direct tool language. Avoid metaphor labels such as lens, ledger, bay, cockpit, or other decorative names unless the actual domain uses that term. Prefer "输入路径", "筛选", "结果", "日志", "配置", "预览", "计划", "执行".

## Action placement rules

Execution controls are part of the workflow, not a loose toolbar.

- Put the primary action in the same visual zone as the current mode, required inputs, and status. The user should be able to answer "what will run?" and press the action without scanning across unrelated panels.
- While running, stop/cancel/disabled-running state must replace the primary action or sit directly beside it. Do not leave a stale run button elsewhere.
- Keep secondary actions as one compact cluster: copy result, copy log, export, open config, reset view. They can sit near the header or result panel, but should not interrupt the primary execution path.
- Separate destructive actions from utility actions. Delete/apply/write actions need explicit confirmation, a direct label, and destructive styling only at the actual gate.
- In compact and portrait layouts, prefer icon buttons with tooltip and `aria-label`, but keep the primary action visually obvious through position, variant, and icon. Do not distribute action buttons across all four corners.
- Risk mode switches such as dry-run/live, overwrite, delete-after, and move/copy belong beside the execution gate or immediately before it. Avoid hiding them in low-frequency settings.
- Avoid full-width action rows with unrelated commands. Group by intent: execute, configure, inspect/copy, reset/recover.

## PackU rewrite requirement

The following nodes currently depend on `@xiranite/packu-node-runtime`, `runPackuTool`, or Python module execution and must be rewritten as native TypeScript nodes:

- `audiov`
- `bitv`
- `classf`
- `classq`
- `coveru`
- `nameu`
- `snf`
- `synct`
- `timeu`
- `transq`

Acceptance for each PackU rewrite:

- `packages/nodes/<id>/src/core.ts` contains the planning and transformation logic in TypeScript.
- `packages/nodes/<id>/src/platform.ts` performs native operations directly or through injected runtime helpers. It must not call `python`, `python -m`, PackU source paths, or `createNodePackuToolRuntime`.
- `package.json` no longer depends on `@xiranite/packu-node-runtime`.
- The app node UI no longer exposes `python`, `sourceRoot`, or `moduleName` as user-facing configuration.
- Existing `status / plan / run` semantics may remain, but labels and result views must match the node domain.
- Tests cover at least parsing/planning plus one execution path with a fake runtime.

## Shared layout rules

Use this shape unless a node has a stronger reason to diverge:

```text
collapsed: icon + status + one decisive metric + primary action
compact: current workflow controls + one preview/result surface
portrait: stacked workflow, status pinned above the scrollable result
full: node-specific workbench with 2-3 semantic zones
```

Good full layouts:

- Pipeline: source -> plan -> commit
- Review desk: candidates -> diff -> action gate
- Gallery: scan controls -> visual grid -> selection tools
- Console: command/config -> live output -> result artifact
- Monitor: timer/signal -> current state -> intervention controls
- Relationship map: source path -> link/target -> recovery list
- Archive pipeline: input queue -> command chamber -> mapping/result output
- Diff bench: source -> transform -> output with highlighted changes
- Timeline/ledger: events or timestamps as the primary navigation structure

Avoid:

- Decorative cards nested inside cards
- Permanent sidebars for low-frequency settings
- One-note palettes per node
- Full-width toolbars with many text buttons
- Hidden execution or risk controls below long logs

## Node briefs

### `bandia` - archive pipeline

Workflow: archive paths or mapping input -> extract/compress/repack -> mapping and logs.

Full layout: three horizontal process bays.

- Input bay: archive/source list, mapping import, path count, paste/clear tools.
- Operation bay: `extract / compress / repack` mode rail, dry-run/live switch, Bandizip executable status, execution gate.
- Output bay: mapping rows `archive -> folder` or `folder -> archive`, errors grouped separately, recent logs as a bottom strip.

Responsive:

- Collapsed: mode + path/mapping count + run button.
- Compact: mode toggle, one-line path input, result summary.
- Portrait: input first, operation gate second, output tabs last.

### `cleanf` - deletion rule board

Workflow: paths -> cleanup presets -> preview deletions -> execute.

Full layout: rule board plus execution gate.

- Rule board: path input and preset chips grouped by risk class.
- Preview board: removable items grouped by preset, skipped items, errors.
- Execution gate: big preview/live state, progress, delete confirmation.

Existing parallel work has started here, but it must still be re-audited. Do not mark it complete unless collapsed/compact/portrait/full all preserve primary controls and the full view is clearly a deletion rule board.

### `coveru` - cover extraction gallery

Workflow: archives -> cover detection -> conversion/output.

Full layout: cover contact sheet.

- Left: archive queue and output/config settings.
- Center: cover thumbnails or placeholders, grouped by archive.
- Right: command/result panel with extraction status and failures.

PackU rewrite: implement archive inspection, cover candidate selection, and output planning in TypeScript. The UI must not expose Python fields.

### `crashu` - folder collision resolver

Workflow: source/target directories -> similarity scan -> move plan -> execute.

Full layout: matching cockpit.

- Left: source and target path pair, direction toggle, similarity/conflict options.
- Center: match lanes with source folder on one side and target candidate on the other.
- Right: conflict policy, selected move summary, destructive gate.

Existing parallel work has started here, but it must still be re-audited. Review conflict visibility and destructive confirmation carefully.

### `dissolvef` - folder dissolve planner

Workflow: path -> dissolve modes -> conflict policy -> plan/apply.

Full layout: dissolve blueprint.

- Top: mode chips for nested/media/archive dissolve.
- Center: folder shell diagram showing "container -> lifted content".
- Right: conflict policy, direct/dry-run switch, execution gate.
- Bottom: history/log strip.

Existing parallel work has started here, but it must still be re-audited. Make sure overwrite mode is visually risky.

### `encodeb` - mojibake repair desk

Workflow: archives -> encoding preset/custom mapping -> before/after names -> repair.

Full layout: encoding comparison table.

- Left: archive queue and encoding preset controls.
- Center: before/after filename diff with unreadable text and repaired text aligned row-by-row.
- Right: strategy (`replace/copy`), scan/preview/recover actions, errors.

Responsive:

- Collapsed: preset + match count.
- Compact: preset toggle and top repair candidates.
- Portrait: controls, then comparison list, then action gate.

### `enginev` - Wallpaper Engine library manager

Workflow: workshop path -> scan -> filter/gallery -> rename/export/delete.

Full layout: visual library.

- Top: path, scan, filter search, rating/type/tag filters.
- Center: wallpaper grid with preview/thumb placeholder, title, size, tags, selected state.
- Right or bottom: batch action tray for rename/export/delete and selected count.

Do not reduce the full view to logs. This node should feel like a small asset browser.

### `envuconfig` - config backup manifest

Workflow: EnvU root -> scan -> manifest -> backup.

Full layout: backup manifest.

- Left: root path, include patterns, backup destination.
- Center: manifest table grouped by config/dotfile/toml.
- Right: backup target preview, overwrite policy, execution gate.

Pack output should emphasize file provenance and target paths.

### `findz` - archive-aware search console

Workflow: paths + SQL-like filter -> scan archives/files -> export result.

Full layout: search console.

- Top: query strip with path, filter, output format.
- Center: result table with expandable archive members.
- Right: result stats, export/copy actions, errors.

Compact can use a command-palette-like query surface.

### `formatv` - `.nov` visibility switchboard

Workflow: scan video folder -> add/remove `.nov` or check duplicates.

Full layout: suffix switchboard.

- Left: folder path and action mode.
- Center: files grouped as playable, hidden `.nov`, prefixed, duplicate candidates.
- Right: change preview and action gate.

Use visual file-state badges rather than plain logs.

### `gifu` - animation frame lab

Workflow: image/archive sequence -> inspect -> plan -> generate GIF/WebP/APNG/video.

Full layout: frame timeline.

- Left: source paths and output format/framerate/options.
- Center: horizontal frame strip or sequence summary with detected frame counts.
- Right: output plan, command details, generation gate, result artifact.

Non-PackU note: `gifu` is still Python-backed. It is not in the PackU rewrite list, but future native TS work should be tracked separately.

### `jellypot` - media launch and registry hub

Workflow: status -> play media / open Jellyfin / apply registry.

Full layout: media control hub.

- Left: media path and player/browser status.
- Center: large launch controls for PotPlayer and Jellyfin with availability indicators.
- Right: registry config preview and dangerous import confirmation.

Registry import must be visually distinct from normal playback actions.

### `kavvka` - duplicate artist folder detector

Workflow: root path + keywords -> scan -> compare plan -> move to `#compare`.

Full layout: duplicate detection board.

- Left: scan root, keyword chips, depth.
- Center: duplicate groups with representative folder, siblings, similarity reason.
- Right: preview/process gate and target `#compare` summary.

### `lata` - task runner console

Workflow: load tasks -> preview command -> execute.

Full layout: task console.

- Left: task list and selected task metadata.
- Center: command preview in terminal style.
- Right: execution output and status.

Keep it quiet and utilitarian; this is a repeat-use operations node.

### `linedup` - line filtering workbench

Workflow: source lines + filter terms -> kept/removed diff -> copy/download.

Full layout: text diff bench.

- Left: source text input.
- Center: filter terms and options.
- Right: diff output with kept/removed highlighting.

This is mostly pure frontend. Prioritize editor ergonomics over decorative effects.

### `linku` - symlink relationship manager

Workflow: inspect path -> create/move link -> list/recover.

Full layout: link map.

- Left: source path and optional target path.
- Center: relationship rows showing `source -> target`, link type, existence.
- Right: create/move/recover controls plus recorded-link list.

Make broken links and recovery candidates first-class states.

### `lorat` - LoRA trigger database

Workflow: scan model files -> infer/apply triggers -> write sidecar/export DB.

Full layout: model trigger board.

- Top: root path, status/scope filters, scan action.
- Center: model cards or dense rows with trigger chips, sidecar state, missing/no-trigger state.
- Right: TriggerDB import/apply/export and destructive write controls.

### `marku` - Markdown transform studio

Workflow: choose module -> input markdown/html -> transform -> output.

Full layout: transform studio.

- Left: module picker grouped by structural, cleanup, table, replace, image-path tools.
- Center: input editor and output preview side-by-side.
- Right: module-specific options and copy/download actions.

Avoid hiding module differences behind a single generic textarea.

### `migratef` - migration flow map

Workflow: source -> target -> preserve/flat/direct -> move/copy -> plan/apply.

Full layout: file migration map.

- Left: source/target paths and migration mode.
- Center: mapped rows `source relative path -> target path`.
- Right: move/copy switch, conflict/error summary, action gate.

### `movea` - regex archive mover

Workflow: scan root -> regex match -> move matched archives/folders.

Full layout: regex routing board.

- Left: scan path and pattern controls.
- Center: match table with archive/folder, extracted key, target folder.
- Right: unmatched group, move gate, stats.

### `mvz` - archive-internal file operator

Workflow: archive path -> select internal files/pattern -> extract/move/delete/rename.

Full layout: archive contents explorer.

- Left: archive path and operation mode.
- Center: archive member tree/list with selection and pattern preview.
- Right: operation preview and destructive gate.

Delete and move must require explicit confirmation.

### `nameu` - native artist archive renamer

Workflow: artist archive folders -> name rules -> before/after rename plan -> run.

Full layout: rename review desk.

- Left: path queue and rule/config summary.
- Center: before/after artist folder names with confidence/reason.
- Right: plan/run status and rollback/log hints.

PackU rewrite: implement NameU rules in TypeScript; remove Python/module fields.

### `owithu` - Windows context menu registry editor

Workflow: TOML config -> registry plan -> register/unregister.

Full layout: registry plan editor.

- Left: TOML/config source and hive selector.
- Center: registry tree preview grouped by hive/key/value.
- Right: register/unregister controls, permission/status, logs.

This node should look like a registry operation surface, not a generic form.

### `rawfilter` - similar archive filter

Workflow: directory -> similarity scan -> keep/move/link plan -> execute.

Full layout: similarity grouping board.

- Left: path, minimum similarity, policy controls.
- Center: groups with primary keep item and duplicate/original candidates.
- Right: trash/multi target summary and irreversible execution gate.

### `recycleu` - recycle bin monitor

Workflow: status -> clean now or timed auto-clean.

Full layout: monitor panel.

- Left: drive and schedule controls.
- Center: circular countdown/progress plus last clean status.
- Right: immediate clean, auto-run cycle count, logs.

Immediate clean and auto clean should remain visually separate.

### `repacku` - native repack workflow

Workflow: analyze folder -> generate config -> compress/repack/gallery pack.

Full layout: stepper workbench.

- Top: stepper `analyze -> config -> pack -> verify`.
- Center: current step content, folder tree, mode recommendation.
- Right: action gate, delete-after risk, generated config/result.

This node already has substantial TS core logic; preserve and expand that path rather than wrapping Python.

### `scoolp` - Scoop operations console

Workflow: status/list packages/sync bucket/cache scan/backup/delete.

Full layout: package operations console.

- Left: action group tabs (`status`, `sync`, `cache`).
- Center: packages, bucket rows, or cache rows depending on action.
- Right: TOML config, destructive cache controls, command output.

Cache delete must be separated from cache scan/backup.

### `seriex` - series archive planner

Workflow: scan folder -> group series -> preview move -> execute/apply.

Full layout: series grouping board.

- Left: scan path and grouping rules.
- Center: series groups with member archive/video rows.
- Right: target directories, prefix/integrity options, execution gate.

### `simiu` - similar image grouping

Workflow: scan image roots -> group by size/signature -> move/copy/link.

Full layout: image grouping grid.

- Left: roots, scan order, apply mode.
- Center: groups with representative thumbnail placeholders and file counts.
- Right: selected group detail, move/copy/link gate.

Existing work already moved this toward a workbench, but it still needs review under the full rewrite standard. Keep improving toward visual grouping.

### `sleept` - power action scheduler

Workflow: choose trigger -> monitor/count down -> sleep/shutdown/restart.

Full layout: scheduler monitor.

- Left: trigger type (`countdown`, `specific time`, `network`, `CPU`) and parameters.
- Center: large countdown/signal monitor.
- Right: power action selection and confirmation.

This node is close to target, but still needs review under the full rewrite standard. Only `trename` is exempt from broad rewrite.

### `smartzip` - archive command deck

Workflow: status/settings or archive operation -> command/result.

Full layout: dual-mode archive deck.

- Left: path queue and SmartZip executable/config status.
- Center: operation preview for extract/codepage/open/archive.
- Right: command output, password/config summary, execution gate.

It should share visual language with `bandia` but not copy the same layout.

### `snf` - native sequence repair

Workflow: numbered folders -> detect gaps/order -> repair plan -> run.

Full layout: sequence repair table.

- Left: path queue and numbering rules.
- Center: before/after sequence list with gap markers.
- Right: plan/run gate and repaired count.

PackU rewrite: implement sequence detection and rename planning in TypeScript.

### `synct` - native timestamp archive

Workflow: files/folders -> extract timestamps -> archive target preview -> run.

Full layout: timestamp timeline.

- Left: path queue and timestamp extraction rules.
- Center: timeline grouped by date/time with target archive names.
- Right: plan/run gate and conflicts.

PackU rewrite: implement timestamp extraction and target planning in TypeScript.

### `timeu` - native timestamp backup/restore

Workflow: files -> backup timestamps or restore timestamps.

Full layout: timestamp ledger.

- Left: path queue and backup/restore mode.
- Center: ledger rows with original timestamps, stored timestamps, target timestamps.
- Right: plan/run gate and missing-record errors.

PackU rewrite: implement timestamp record parsing, backup planning, and restore planning in TypeScript.

### `transq` - native translation queue organizer

Workflow: translation files -> queue plan -> organize output.

Full layout: queue board.

- Left: translation file queue and config/rule summary.
- Center: lanes for pending/ready/output/conflict items.
- Right: plan/run gate and queue result.

Parallel work has already expanded the UI. It still must remove Python/module fields after native TS rewrite.

## Implementation batches

Batch A, already touched by parallel work but still not accepted:

- `cleanf`
- `coveru`
- `crashu`
- `dissolvef`
- `transq`

Before editing these again, run a focused review and typecheck. Work with their current diffs, but rewrite again when the design is still generic.

Batch B, high UI value and not currently dirty:

- `bandia`
- `encodeb`
- `enginev`
- `findz`
- `formatv`

Batch C, file operation planners:

- `linku`
- `migratef`
- `movea`
- `mvz`
- `rawfilter`
- `seriex`

Batch D, text/model/system tools:

- `linedup`
- `lorat`
- `marku`
- `owithu`
- `recycleu`
- `scoolp`
- `sleept`

Batch E, media/config/special tools:

- `envuconfig`
- `gifu`
- `jellypot`
- `kavvka`
- `lata`
- `smartzip`
- `simiu`

Batch F, PackU native TypeScript rewrites:

- `audiov`
- `bitv`
- `classf`
- `classq`
- `coveru`
- `nameu`
- `snf`
- `synct`
- `timeu`
- `transq`

Do not mark Batch F complete while any of those nodes still imports `@xiranite/packu-node-runtime`, contains Python command fields, or calls `python -m`.

## Verification

For each node batch:

```powershell
bun run tsgo --noEmit
bun run vitest run src/nodes/<node-id>
```

For PackU rewrites:

```powershell
bun --filter @xiranite/node-<node-id> test
bun --filter @xiranite/node-<node-id> build
bun scripts/validate-node-architecture.ts --node <node-id>
rg -n "packu-node-runtime|runPackuTool|python -m|sourceRoot|moduleName|data\.python" packages/nodes/<node-id> src/nodes/<node-id>
```

Completion evidence must include:

- No remaining generic full layouts for any node except `trename`.
- No text overflow or incoherent overlap in collapsed/compact/portrait/full.
- Dangerous actions still gated.
- PackU rewrite search returns no Python wrapper references for rewritten nodes.
- Targeted tests and typecheck pass for the touched batch.
- Existing Bento/card screenshot tooling has been used for visual checks where available. Default to one bento matrix screenshot per node so collapsed/compact/portrait/expanded widths are inspected together. Only capture extra screenshots when the matrix reveals a specific issue that needs a close-up.
