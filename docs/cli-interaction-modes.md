# CLI interaction modes

This document defines the shared interaction contract for Xiranite node CLIs.
All node migrations to Ink must follow it.

## Modes

| Mode | Entry | Intended use |
| --- | --- | --- |
| `ui` | `xnode ui` | Full Ink terminal UI that mirrors the node GUI's fields, preview, confirmation, progress, and result views. |
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
- `NO_COLOR=1` disables colour in `gd`; Ink follows the terminal's colour
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

Ink `ui` is a projection of the GUI node, not a separate workflow. It must use
the same core input type, defaults, validation, preview/dry-run policy, danger
confirmation, progress events, and result model as the GUI component.

## TUI component policy

Use an established Ink component library before writing terminal primitives:

1. [Termcn](https://github.com/shadcn-labs/termcn) is the preferred source for
   terminal UI components and layouts.
2. [InkUI](https://github.com/karimfromjordan/ink-ui) is the fallback when
   Termcn does not provide the required interaction.
3. A custom component is allowed only when neither library offers an equivalent;
   it must be small, accessible, and reusable through `cli-runtime`.

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
`--lang`, node `interaction_language`, locale environment variables, English.

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
Ink/Termcn adapter now  |  OpenTUI/Termcn adapter later
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

## Migration order

1. Shared runtime primitives and tests.
2. System workflows: `sleept`, `recycleu`, `timeu`, `soundw`.
3. File workflows with preview and confirmation.
4. Remaining multi-step GUI nodes.

Pure one-shot nodes remain command-only unless their GUI exposes more than one
meaningful form/action/result flow.
