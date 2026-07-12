# termcn OpenTUI registry

`@xiranite/cli-runtime` is the shared terminal-workbench package. OpenTUI node
screens must prefer termcn components before creating a shared adapter.

## Local complete snapshot

All `@termcn/opentui/*` registry entries are downloaded as unmodified registry
JSON (including their source files, dependencies and metadata) to
`packages/cli-runtime/termcn-registry/opentui/`. They are deliberately not
statically exported: importing every item would add optional native or
terminal-only dependencies to the Node-safe and desktop-safe runtime boundary.

Refresh the snapshot when termcn changes:

```bash
cd packages/cli-runtime
bun run sync:termcn
```

Use the local snapshot to choose a component first. For an update or a new
component, follow the shadcn registry flow:

```bash
bunx --bun shadcn@latest search @termcn -q "<capability>"
bunx --bun shadcn@latest view @termcn/opentui/<component>
bunx --bun shadcn@latest add @termcn/opentui/<component> --dry-run
bunx --bun shadcn@latest add @termcn/opentui/<component> --yes
```

Only create a thin shared adapter when termcn has no matching component or the
official component lacks a verified requirement such as individual mouse hit
targets. `ActionTabs` is one such adapter: all tabs retain the same box height
and it adds mouse targeting on top of the termcn tab model.

## Themes

Every termcn OpenTUI theme is available through the runtime palette catalogue.
The current registry set is: `default`, `nord`, `dracula`, `high-contrast`,
`high-contrast-light`, `catppuccin`, `catppuccin-frappe`,
`catppuccin-macchiato`, `monokai`, `one-dark`, `onedarkpro`, `solarized`,
`tokyo-night`, `amoled`, `aura`, `ayu`, `carbonfox`, `cobalt2`, `cursor`,
`everforest`, `flexoki`, `github`, `gruvbox`, `kanagawa`, `lucent-orng`,
`material`, `matrix`, `mercury`, `nightowl`, `oc-2`, `opencode`, `orng`,
`osaka-jade`, `palenight`, `rosepine`, `shadesofpurple`, `synthwave84`,
`vercel`, `vesper`, and `zenburn`.

**Nord is the global terminal fallback.** A node setting of
`nodes.<id>.cli.theme = "inherit"` therefore previews and runs in Nord; a
named setting selects that local CLI theme. Desktop UI settings remain separate
at `nodes.<id>.ui.theme`.

Termcn's `ThemeProvider`, `types`, `spinner`, and number-input sources are
already incorporated in the shared runtime. New node TUI code should import
through `@xiranite/cli-runtime/terminal/opentui`, never from the Node-safe
`@xiranite/cli-runtime/terminal` entrypoint.
