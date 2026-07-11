# CLI interaction modes

This document defines the shared interaction contract for Xiranite node CLIs.
All node terminal-UI migrations must follow it.

## Modes

| Mode | Entry | Intended use |
| --- | --- | --- |
| `ui` | `xnode ui` | Fullscreen, mouse-first terminal workbench that mirrors the node GUI's fields, preview, confirmation, progress, and result views through the selected Ink or OpenTUI renderer. |
| `gd` | `xnode gd` | Compact guided flow for quick selection and confirmation. Existing `guided` remains a compatibility alias for `gd`. |
| `pipe` | normal subcommands, arguments, `--json`, or stdin | Scriptable and composable command path. It never renders Ink or prompt UI. |

## Default interactive mode

Node configuration may contain:

```json
{
  "interaction_mode": "ui",
  "interaction_renderer": "ink",
  "interaction_language": "zh",
  "interaction_theme": "dracula"
}
```

Allowed values are `ui` and `gd`; `ui` is the default when unset.

When launched with no arguments in a real terminal, a node enters the configured
default mode. Users can always override it explicitly with `ui` or `gd`.

Full UI preferences can be overridden per invocation:

```powershell
xsleept ui --renderer ink --lang zh --theme dracula
xsleept ui --renderer opentui --lang en --theme high-contrast
```

The preference field names and normalization live in `@xiranite/cli-runtime`,
so every migrated node reads the same configuration model. Camel-case names are
accepted for compatibility with existing GUI-saved node configuration.

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
Ink enters the terminal alternate screen and restores the cursor, mouse mode,
and original screen on normal exit, Ctrl+C, and exceptions. OpenTUI uses its
equivalent alternate-screen lifecycle.

## TUI component policy

Use an established terminal component library before writing primitives:

1. [Termcn](https://github.com/shadcn-labs/termcn) is the preferred source for
   terminal UI components and layouts.
2. [InkUI](https://github.com/karimfromjordan/ink-ui) is the fallback when
   Termcn does not provide the required interaction.
3. A custom component is allowed only when neither library offers an equivalent;
   it must be small, accessible, and reusable through `cli-runtime`.
4. Ink mouse hit testing uses `@ink-tools/ink-mouse`; OpenTUI uses its native
   mouse events. Node packages never import either mouse API directly.

## Shared themes and i18n

Ink and OpenTUI consume the same terminal theme registry. The initial registry
contains Termcn's `default`, `dracula`, and `high-contrast` palettes and can be
extended through `registerTerminalTheme`; nodes never define renderer-specific
colours.

Internationalisation uses `i18next` core in independently distributed CLI
packages. Do not import the browser singleton or `react-i18next` into a CLI.
Each invocation creates an isolated i18next instance with English fallback,
interpolation, and node-owned resource namespaces. The GUI continues to use
`react-i18next` but merges the same package-owned node resources, so shared
field labels are not translated twice. Language resolution is, in order:
`--lang`, node `interaction_language`, locale environment variables, Chinese.
English remains the i18next fallback for an individual missing translation key.

## Renderer compatibility

Do not couple a node's interaction schema or workflow to Ink. Node packages
expose renderer-neutral screen state, field definitions, keyboard intents, and
core execution callbacks. `cli-runtime` supplies a renderer adapter selected by
the interaction host:

```text
node interaction schema + core action runner
             ↓
renderer-neutral screen model and intents
             ↓
Ink/Termcn adapter  |  OpenTUI/Termcn adapter
```

The two adapters must preserve the same commands (`ui`, `gd`), field IDs,
defaults, keyboard intents, confirmation policy, and result model. Renderer
selection is an internal runtime option, never a node-specific fork or a public
pipeline format change. This allows a future OpenTUI switch without changing
individually distributed node packages or their scriptable CLI interface.

OpenTUI's current React package resolves correctly under Bun but its latest
release is not directly loadable by Node ESM. The shared runner therefore
re-executes only an explicitly selected OpenTUI session with Bun. Ink, `gd`, and
all pipe commands retain normal Node compatibility. This compatibility bridge
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
- `@xiranite/cli-runtime/terminal` is the only public entrypoint allowed to
  reach Ink, OpenTUI, Bun re-execution, terminal themes, or renderer runners.
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
2. **UI:** `ui` with a fake TTY starts the Ink entry point and passes the same
   input to core as the GUI workflow.
3. **GD:** `gd` with a fake TTY starts the compact guide; `guided` invokes the
   same implementation as a compatibility alias.
4. **Non-TTY guard:** `ui` and `gd` on a non-TTY exit 2, keep stdout empty, and
   write the error to stderr.
5. **Default routing:** no arguments route to `interaction_mode` only with a
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
   cannot reach `@xiranite/cli-runtime/terminal`, Ink, OpenTUI, or Bun-native
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
