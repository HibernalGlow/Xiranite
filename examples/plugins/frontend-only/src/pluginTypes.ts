import type { PluginHostSurface } from "@xiranite/plugin-sdk"

// The plugin-facing props type comes from the SDK too, so this package carries no copy of the host
// shape at all: `PluginComponentProps` is `{ compId, host: PluginHostSurface }` there, with `Component`
// typed as a JSX-usable react return (§2.4's projection is what a remote actually receives, which is
// narrower than contract's internal `NodeComponentProps`).
export type { PluginComponentProps } from "@xiranite/plugin-sdk"

/** Kept as a name the preview page can annotate its stand-in host with. */
export type { PluginHostSurface as PluginHostApi } from "@xiranite/plugin-sdk"
