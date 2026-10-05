/**
 * The plugin's view of the host, taken from `@xiranite/plugin-sdk`.
 *
 * This file used to hand-copy four structural shapes, and said so out loud: the contract package was
 * not installable from outside the repository, so duplicating the two members actually used was the
 * honest POC move — and the argument for §12's SDK. That premise is now gone: the SDK vendors
 * contract's emitted declarations, so an out-of-repo plugin can install it (`file:` resolves today;
 * it failed with `@xiranite/contract@workspace:* failed to resolve` before the vendoring step).
 *
 * Keeping the copy would be the drift §12 exists to prevent, so the types below are aliases onto the
 * published surface rather than a re-declaration of it.
 */

import type { PluginHostSurface } from "@xiranite/plugin-sdk"

/** What the host hands the component. The capability ceiling is the host's decision, not this file's. */
export type PluginHostApi = PluginHostSurface

export interface PluginComponentProps {
  compId: string
  host: PluginHostApi
}
