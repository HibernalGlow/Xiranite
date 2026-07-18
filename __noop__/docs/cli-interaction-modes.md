# CLI interaction modes

This document defines the shared interaction contract for Xiranite node CLIs.
All node terminal-UI migrations must follow it.

## Xiranite terminal workspace

The aggregate `xiranite` command owns a fullscreen OpenTUI workspace in
addition to dispatching individual node CLIs. `xiranite ui`, or `xiranite`
without arguments in a real TTY, opens the workspace. Non-TTY invocation stays
plain and prints help instead of emitting ANSI.

The terminal workspace reads and writes the same `WorkspaceSnapshotDTO` used
by the Web desktop. Node deployment, removal, and Bento position/size changes
therefore survive switching between Web and terminal surfaces. The 12-column
`bentoLayout` remains the persisted source of truth; terminal dimensions are a
responsive projection and never replace shared layout data with character-cell
coordinates.

The workspace provides node discovery/search, mouse deployment, workspace
selection, component selection, move/resize/remove controls, entry into the
selected package-owned node TUI, and the shared global operation queue. F9
opens the queue from either the aggregate workspace or a node TUI. Backend
sync and shared execution require `XIRANITE_BACKEND_URL`; authenticated local
backends additionally use `XIRANITE_BACKEND_TOKEN`.

Before implementing or reviewing a node TUI, look for the node's existing GUI
captures under `output/playwright` first. Most package nodes already have one
or more decisive workflow screenshots there. Use `bun run qa:node-baselines --
--only <id>` only to fill a missing fullscreen baseline or refresh a stale one.
The script opens entries from the generated external/package-node registry as
a fullscreen Cards workspace and writes stable PNG names plus `manifest.json`
under `output/playwright/node-gui-baselines`. The GUI image is the TUI
interaction/layout reference, and the same command is the post-implementation
visual regression check. `src/nodes/__backup__` remains a read-only archive and
is never used as the capture source.

### Terminal image layers

完整的协议、性能、失败案例和测试说明见
[`opentui-sixel-gallery-lessons.md`](./opentui-sixel-gallery-lessons.md)。

- Native SIXEL and Kitty graphics are terminal-level overlays. They do not automatically participate in OpenTUI layout, clipping, z-order, or `scrollbox` scrolling, so an image-heavy node may own an independent compositor instead of using the shared schema renderer.
- A scrolling SIXEL gallery must reset DECSDM (`CSI ? 80 l`) so drawing cannot scroll the whole terminal, erase its previous viewport with DECERA before OpenTUI redraws, and emit only images fully inside the current viewport after the frame.
- Use opaque SIXEL background mode for retained-mode redraws. Background mode `1` preserves old pixels and causes cumulative colour stripes when a card is redrawn at the same location.
- Resize or crop sources to their final card dimensions before encoding, cache encoded SIXEL payloads, and debounce continuous wheel input so only the final visible set is redrawn.

## Modes

| Mode | Entry | Intended use |
| --- | --- | --- |
| `ui` | `xnode ui` | Fullscreen, mouse-first OpenTUI workbench that mirrors the node GUI's fields, preview, confirmation, progress, and result views. |
| `gd` | `xnode gd` | Compact guided flow for quick selection and confirmation. Existing `guided` remains a compatibility alias for `gd`. |
| `pipe` | normal subcommands, arguments, `--json`, or stdin | Scriptable and composable command path. It never renders OpenTUI or prompt UI. |

## Default interactive mode

GUI and CLI/TUI preferences are intentionally separated. Node configuration may contain:

```toml
[nodes.sleept.ui]
theme = "inherit"
default_mode = "workbench"

[nodes.sleept.cli]
theme = "dracula"
default_mode = "ui"
language = "zh"
```

`nodes.<id>.ui` belongs only to the desktop/browser node. `nodes.<id>.cli`
belongs to `ui`, `gd`, and `pipe`. The two sections may independently use
`inherit`, which resolves against the app-wide GUI or CLI preference rather
than against each other. CLI `default_mode` accepts `ui`, `gd`, or `pipe`;
`ui` is the default when unset. The old top-level `interaction_mode`,
`interaction_language`, `interaction_theme`, and camel-case variants are not
read or migrated; node interaction settings must live in the `cli` table.

When launched with no arguments in a real terminal, a node enters the configured
default mode. Users can always override it explicitly with `ui` or `gd`.

Full UI preferences can be overridden per invocation:

```powershell
xsleept ui --renderer opentui --lang en --theme high-contrast
```

The preference field names and normalization live in `@xiranite/cli-runtime`,
so every migrated node reads the same configuration model.

When stdin or stdout is not a TTY, no-argument invocation must not enter an
interactive mode. The command must either process the documented stdin format or
write a plain usage error to stderr and exit with code 2.

## Stream contract

- `pipe` stdout contains only the requested result (JSON for `--json`).
- Diagnostics, warnings, and usage errors go to stderr.
- `ui` and `gd` require both stdin and stdout to be TTYs.
- Calling `ui` or `gd` without a TTY writes no ANSI bytes to stdout, writes a
  concise TTY requirement error to stderr, and exits with code 2.
- `NO_COLOR=1` disables colour in `gd`; UI renderers follow the terminal's colour
  capability and must not alter pipe output.

## Package-owned interaction schema

Every distributable `@xiranite/node-*` package owns its interaction schema in
its own source tree (for example `src/interaction.ts`). The schema contains the
node's fields, defaults, option lists, validation, danger policy, and mapping
to the core input type. The GUI imports that schema from the node package.

`@xiranite/cli-runtime` must remain node-agnostic: it provides only mode
routing, TTY guards, rendering lifecycle, and test helpers. It must never own a
specific node's form schema. This keeps each CLI package independently
installable and prevents a frontend dependency from leaking into distribution.

## GUI parity

`ui` is a projection of the GUI node, not a separate workflow. It must use
the same core input type, defaults, validation, preview/dry-run policy, danger
confirmation, progress events, and result model as the GUI component.

The fullscreen UI is a workbench, not a guided wizard. All relevant controls
remain visible and editable in place. Mouse interaction is primary where the
renderer supports it; Tab, arrows, Enter, and Escape remain keyboard fallbacks.
OpenTUI owns the alternate-screen lifecycle and restores the cursor, mouse mode,
and original screen on normal exit, Ctrl+C, and exceptions.

### Action efficiency

- Tabs switch views or persistent configuration contexts. They are not command
  buttons and must not be used as a mandatory step before execution.
- A safe action that needs no further input is a one-click command button and
  starts immediately. A dangerous one-click action opens confirmation on the
  first click; it must not require a preceding action-selection click.
- An action may keep a separate execute button only when the user must configure
  fields, review a generated plan, or select result rows after choosing it.
- A workbench may combine both forms: configurable workflows use a selector and
  execute/confirm controls, while queries, refreshes, restores, and other atomic
  commands use the shared `ActionLauncher` button strip.
- Automated mouse tests must assert the click count: atomic actions execute from
  one command click, while dangerous atomic actions reach confirmation in one
  click.

## TUI component policy

The shared runtime is a termcn/OpenTUI component host. Nodes never copy or
fork terminal components. Use this order before writing a primitive:

1. Use `@termcn/opentui/*` through the shadcn registry. Shared runtime owns the
   checked-in source and nodes import only the runtime abstraction.
2. If termcn has no matching component, use the official OpenTUI native
   component or example under `ref/opentui/packages/examples`.
3. Any unavoidable custom control with reuse value must first be implemented as an
   independent component under `cli-runtime/src/tui/opentui`; compositions
   import it instead of embedding the implementation in `app.tsx`.
4. A custom component is allowed only when termcn and OpenTUI both lack the
   required behavior, or when an upstream component cannot meet a tested mouse
   or safety requirement. The reason must be recorded beside the adapter.
5. OpenTUI uses native mouse events. Node packages never import mouse APIs
   directly.

### Shared header and help

Direct node TUIs keep reset and exit actions in the existing top header; they
must not add a persistent footer solely for navigation or usage hints. The
buttons use the shared header action component so their visible bounds and
mouse hit regions remain identical. Do not repeat static hints such as
"mouse-first", "editable paths", or "F1 help" inside every node composition.

Every node package exports its serializable `NodeHelp` from `./help`. That one
source powers `help`/`--help`/`-h`, the summary shown before a `gd` flow, the
OpenTUI F1 help surface, and the Web help view. Renderer-specific copies of the
help text are not allowed.

### Terminal icons and editable controls

- Every section, field kind, action, status, and result surface uses the shared
  semantic icon registry.
- Glyph priority is Unicode, optional Nerd Font mapping, Iconify JSON mapping,
  then Braille/box-drawing characters for charts and dense visualizations.
  Unicode is always the portable fallback; Nerd Font is never required.
- Numeric controls must support direct text entry as well as mouse wheel and
  `-` / `+` controls. A stepper-only numeric field is not accepted.
- Path lists and multiline values use termcn/OpenTUI editors with a plain text
  fallback in `gd`; pipe values remain unchanged.

### Shared preference workbench

Every migrated TUI exposes one shared preferences surface for live theme
preview, default-mode selection, current-config inspection, save, and restore.
Saving writes the node's `nodes.<id>.cli` table in the global TOML. It must not
modify `nodes.<id>.ui`. GUI nodes use their existing shared configuration UI to
read and write the separate `nodes.<id>.ui` table.

## Shared themes and i18n

OpenTUI consumes the complete checked-in termcn OpenTUI theme registry; Nord
is the global CLI fallback. The local snapshot and exact current theme list
live in `docs/termcn-registry.md`. Nodes never define renderer-specific
colours and may extend the shared registry only through `registerTerminalTheme`.

Internationalisation uses `i18next` core in independently distributed CLI
packages. Do not import the browser singleton or `react-i18next` into a CLI.
Each invocation creates an isolated i18next instance with English fallback,
interpolation, and node-owned resource namespaces. The GUI continues to use
`react-i18next` but merges the same package-owned node resources, so shared
field labels are not translated twice. Language resolution is, in order:
`--lang`, node `cli.language`, locale environment variables, Chinese.
English remains the i18next fallback for an individual missing translation key.

## Direct OpenTUI composition

OpenTUI is the only full-screen renderer. New node UIs do not use a
renderer-neutral schema to auto-generate their layout. Each node owns a
terminal-only `Tui.tsx` and may directly compose OpenTUI JSX and shared termcn
components. This preserves maximum control over layout, mouse regions,
animation, scrolling, responsive degradation, and node-specific displays.

The interaction schema remains browser-safe and is used for shared values,
validation, danger policy, preview data, and the compact `gd` flow. It does not
contain JSX, positions, renderer component names, or mandatory layout enums.
`Tui.tsx` may consume the same session/schema data where useful without being
generated by it.

Shared code is split by responsibility:

- `runInteractionCli` owns TTY checks, `ui`/`gd`/`guided`/`pipe` routing,
  common flags, theme validation, error codes, and Bun re-execution.
- `@xiranite/cli-runtime/testing` owns memory hosts, standard mode cases, and
  ANSI helpers used by every node test.
- `@xiranite/cli-runtime/terminal/opentui` owns termcn components, theme and
  preference panels, session hooks, semantic icons, and workbench primitives.
- Node `Tui.tsx` files own only node-specific composition and presentation.

The previous automatic schema renderer remains temporarily available for nodes
already migrated to it, but new work must use direct `Tui.tsx`; migrate and
remove the compatibility renderer after its remaining consumers are converted.

OpenTUI's current React package resolves correctly under Bun but its latest
release is not directly loadable by Node ESM. The shared runner therefore
re-executes an OpenTUI session with Bun. `gd` and all pipe commands retain
normal Node compatibility. This compatibility bridge
is centralized in `cli-runtime` and can be removed when upstream Node ESM
support is fixed.

## Browser and terminal entry isolation

OpenTUI is terminal-only. It must never be reachable from the desktop/Vite
browser module graph, even through a dynamic import. Its native platform
modules and Bun `with: { type: "file" }` imports are not valid browser input.

- `@xiranite/cli-runtime` contains general CLI helpers and must not export or
  import `runTerminalUi`, OpenTUI, or a renderer adapter.
- `@xiranite/cli-runtime/i18n` and `@xiranite/cli-runtime/interaction` are the
  browser-safe shared entrypoints for translations, schemas, and interaction
  types.
- `@xiranite/cli-runtime/terminal` is Node-safe and owns routing plus the
  dynamic Bun/OpenTUI runner; it must not statically re-export OpenTUI React
  components.
- `@xiranite/cli-runtime/terminal/opentui` is Bun/OpenTUI-only. Node `Tui.tsx`
  imports components from this subpath, and the CLI loads that file only after
  `ui` routing and Bun re-execution.
- Desktop node components import a node's explicit `./interaction` or `./i18n`
  subpath. A node root `index.ts` exposes only `def` and `core`; it must not
  re-export CLI, TUI, interaction, or translation adapters.
- Backend node discovery also loads only `def` and `core`. CLI entrypoints are
  loaded explicitly by the CLI registry, not as a side effect of node import.
- Do not mark `@opentui/core-*-arm64` packages as Vite externals. That hides the
  invalid dependency edge during compilation and moves the failure to runtime.

The boundary tests plus a desktop production build are required whenever these
exports change.

## Required tests for every migrated node

1. **Pipe:** a scripted subcommand with `--json` produces parseable JSON on
   stdout and no ANSI control sequences.
2. **UI:** `ui` with a fake TTY starts the OpenTUI entry point and passes the same
   input to core as the GUI workflow.
3. **GD:** `gd` with a fake TTY starts the compact guide; `guided` invokes the
   same implementation as a compatibility alias.
4. **Non-TTY guard:** `ui` and `gd` on a non-TTY exit 2, keep stdout empty, and
   write the error to stderr.
5. **Default routing:** no arguments route to `cli.default_mode` only with a
   real TTY; otherwise they use the pipe-safe fallback.
6. **Mouse workbench:** automated PTY or renderer-native mouse tests change a
   mode, edit a field or toggle, open and dismiss danger confirmation, execute
   or cancel a safe task, and switch result/log tabs. Manual clicking is not an
   acceptance test.
7. **Fullscreen lifecycle:** tests prove the alternate screen and mouse modes
   are enabled for the UI and restored after exit.
8. **Language:** no flag, config, or locale defaults to Chinese; explicit or
   configured English still overrides it.
9. **Browser boundary:** importing a desktop node's interaction/i18n subpaths
   cannot reach `@xiranite/cli-runtime/terminal`, OpenTUI, or Bun-native
   modules; the desktop Vite production build must pass.

## Test safety for dangerous actions

This rule was added after an automated Sleept mouse test used the production
runtime and two adjacent hitboxes overlapped: the click intended for “返回检查”
also activated “确认执行”, causing the developer computer to enter real sleep.
That incident is a test-harness failure; it must not be possible to repeat it.

UI, mouse, visual, snapshot, and integration tests must never connect a node to
a real destructive or machine-state-changing executor. This includes sleep,
shutdown, restart, deletion, device switching, and comparable host actions.

- Tests must inject a no-op/fake runtime at the action boundary before starting
  the terminal UI. A dry-run value in the form is not a sufficient safety
  boundary because the test intentionally toggles that value.
- A test may turn dry-run off only to verify the warning and confirmation flow.
  Even if a hit-test or focus bug activates the confirm control, the injected
  executor must remain harmless.
- The test must assert that the real executor was never called. Tests covering
  dispatch use a spy/fake executor and assert only the fake call.
- Adjacent click targets need non-overlapping bounds. Mouse regression tests
  must cover dismiss versus confirm so a boundary click cannot trigger both.
- Never run a mouse scenario against the production CLI entrypoint when its
  runtime can reach real host actions. Use a dedicated test entrypoint or an
  injected runtime dependency.

## Migration order

1. Shared runtime primitives and tests.
2. System workflows: `sleept`, `recycleu`, `timeu`, `soundw`.
3. File workflows with preview and confirmation.
4. Remaining multi-step GUI nodes.

Pure one-shot nodes remain command-only unless their GUI exposes more than one
meaningful form/action/result flow.
