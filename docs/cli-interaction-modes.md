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
  "interaction_mode": "ui"
}
```

Allowed values are `ui` and `gd`; `ui` is the default when unset.

When launched with no arguments in a real terminal, a node enters the configured
default mode. Users can always override it explicitly with `ui` or `gd`.

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

## GUI parity

Ink `ui` is a projection of the GUI node, not a separate workflow. It must use
the same core input type, defaults, validation, preview/dry-run policy, danger
confirmation, progress events, and result model as the GUI component.

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
