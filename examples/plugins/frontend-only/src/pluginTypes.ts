/**
 * The minimum structural shape this plugin relies on, written by hand on purpose.
 *
 * The real contract lives in `packages/contract` (`NodeDef`, `NodeComponentProps`,
 * `NodeHostCapabilities`), but that package is not yet a published/shared artifact a plugin outside
 * this repository can depend on — hand-copying the two fields we actually use is the honest POC
 * move, and it is the concrete argument for `@xiranite/plugin-sdk`
 * (`docs/plugin-architecture.md` §12): today a plugin author has to duplicate our types, and
 * duplication is how contracts drift.
 *
 * Every field is optional except what we read. `unknown` on `host`'s namespaces is intentional: the
 * host may withhold a capability it did not grant, so a plugin must narrow at use time.
 */

export interface PluginNodeDef {
  id: string
  name: string
  version: string
  category: string
  description: string
  icon: string
}

export interface PluginHostApi {
  env?: { theme?: string; platform?: string }
  contract?: {
    name: string
    version: string
    supportedCapabilities?: readonly string[]
    hasCapability?: (capability: string) => boolean
  }
  state?: { getData: (id: string) => unknown; patchData: (id: string, data: unknown) => void }
  config?: { get: (key: string) => unknown; save: (key: string, value: unknown) => void }
}

export interface PluginComponentProps {
  compId: string
  host: PluginHostApi
}
