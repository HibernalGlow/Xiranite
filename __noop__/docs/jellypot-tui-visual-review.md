# JellyPot TUI visual review

## References

- GUI comparison sheet: `output/playwright/jellypot/jellypot-reference-review.jpg`
- OpenTUI PTY capture: `artifacts/cli/jellypot/media-bridge.png`

## GUI-to-terminal mapping

The GUI action picker is preserved as Unicode-labelled action tabs. Its path controls and result tabs become a persistent media bridge with three regions: launch controls, dependency checks, and command/runtime logs. This keeps the selected media and the launch consequence visible together instead of hiding them behind result tabs.

The shared top bar retains reset, exit, node preferences, help, and task queue actions. The workbench uses termcn-derived shared fields, tabs, panels, execution actions, progress, and terminal theme handling; only the JellyPot panel composition and playback pulse are node-specific.

## Interaction and safety

- `pipe`, `gd` (`guided` alias), and `ui` coexist through the shared interaction router.
- Unicode symbols identify status, playback, Jellyfin, and registry actions without requiring a patched font.
- The running state uses a restrained four-frame playback pulse.
- Live registry application is the dangerous path and requires a second confirmation; dry run remains the initial value.
- Node-local terminal preferences persist under `nodes.jellypot.cli`.

