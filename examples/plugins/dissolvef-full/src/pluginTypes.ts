/**
 * The plugin's copy of the host contract — the slice of the ABI this example needs.
 *
 * This file is a **hand-maintained copy**, and that is a finding, not a style choice: today there is
 * no published `@xiranite/plugin-sdk`, so an out-of-repo plugin has nothing to import (`docs/
 * plugin-architecture.md` §12). Everything here is transcribed from the producers, field for field:
 *
 *   - `NodeRunEvent`            <- `nodeRunEventSchema` (`packages/shared/src/index.ts:91-98`)
 *   - `NodeRunResult`           <- `nodeRunResultSchema` (`packages/shared/src/index.ts:100-106`)
 *   - `NodeRunnerCapability`    <- `packages/contract/src/index.ts:308-318`
 *   - `NodeContractCapability`  <- `packages/contract/src/index.ts:290-295`
 *   - `NodeEnvCapability`       <- `packages/contract/src/index.ts:426-429`
 *
 * When `@xiranite/plugin-sdk` exists, this file is what it replaces; a plugin must not be the place
 * where the ABI is re-typed, because a drift here is silent at build time and shows up as a runtime
 * `undefined is not a function`.
 *
 * Every host field is optional *here* even though the internal contract marks some of them required:
 * a third party has to degrade when the host grants less, and the host's own capability projection is
 * not implemented yet (measured: `host.contract.supportedCapabilities` currently lists all nine).
 */

export interface NodeRunEvent {
  type: "progress" | "log"
  progress?: number
  message: string
  data?: unknown
}

export interface NodeRunResult<TData = unknown> {
  success: boolean
  message: string
  data?: TData
  stats?: Record<string, number>
  outputPath?: string
}

export interface NodeRunnerCapability {
  run?: <TInput = unknown, TData = unknown>(
    nodeId: string,
    input: TInput,
    onEvent?: (event: NodeRunEvent) => void,
  ) => Promise<NodeRunResult<TData>>
  cancelCurrent?: () => Promise<boolean>
}

export interface NodeContractCapability {
  name?: string
  version?: string
  supportedCapabilities?: readonly string[]
}

export interface NodeEnvCapability {
  theme?: "light" | "dark"
  platform?: string
}

export interface PluginHost {
  runner?: NodeRunnerCapability
  contract?: NodeContractCapability
  env?: NodeEnvCapability
}

export interface PluginComponentProps {
  compId: string
  host: PluginHost
}
