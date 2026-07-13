import type { NodeRunEventDTO as NodeRunEvent, NodeRunResultDTO as NodeRunResult } from "@xiranite/shared"

/**
 * Host capability contract version. Nodes declare a compatible range via
 * {@link NodeHostRequirements.contractVersion}; the host exposes this via
 * {@link NodeContractCapability.version}.
 */
export const NODE_HOST_CONTRACT_VERSION = "1.0.0" as const

export type NodeCategory =
  | "file"
  | "image"
  | "video"
  | "text"
  | "system"
  | "dev"
  | "crawler"
  | "other"
  | string

export type NodePhase =
  | "idle"
  | "running"
  | "paused"
  | "completed"
  | "cancelled"
  | "error"
  | string

export interface NodeDef {
  id: string
  name: string
  version: string
  category: NodeCategory
  description: string
  icon: string
  keywords?: string[]
}

export interface NodeHelpExample {
  label?: string
  command: string
  description?: string
}

export interface NodeHelpCommand {
  title: string
  command?: string
  description?: string
  examples: readonly NodeHelpExample[]
}

export interface NodeHelpWorkflow {
  title: string
  summary?: string
  ui?: readonly string[]
  cli?: readonly string[]
  tips?: readonly string[]
}

export interface NodeHelpField {
  name: string
  type?: string
  required?: boolean
  description: string
  defaultValue?: string
}

export interface NodeHelpSafety {
  defaultMode?: "preview" | "dry-run" | "guided" | "live" | string
  destructive?: readonly string[]
  notes?: readonly string[]
}

export interface NodeHelpLink {
  label: string
  href: string
  description?: string
}

export interface NodeHelpTranslation {
  title?: string
  short?: string
  description?: string
  whenToUse?: readonly string[]
  workflows?: readonly NodeHelpWorkflow[]
  commands?: readonly NodeHelpCommand[]
  fields?: readonly NodeHelpField[]
  safety?: NodeHelpSafety
  links?: readonly NodeHelpLink[]
}

/**
 * Structured node usage documentation shared by the app and CLI.
 *
 * Keep this as serializable data only. Node packages should export it from
 * `./help`; React components, terminal adapters, and host-specific logic stay
 * outside this contract.
 */
export interface NodeHelp {
  title: string
  short: string
  description?: string
  whenToUse?: readonly string[]
  workflows: readonly NodeHelpWorkflow[]
  commands: readonly NodeHelpCommand[]
  fields?: readonly NodeHelpField[]
  safety?: NodeHelpSafety
  links?: readonly NodeHelpLink[]
  translations?: Readonly<Record<string, NodeHelpTranslation>>
}

export function localizeNodeHelp(help: NodeHelp, locale: string | undefined): NodeHelp {
  const translation = findNodeHelpTranslation(help, locale)
  if (!translation) return help
  return {
    ...help,
    ...translation,
    translations: help.translations,
  }
}

function findNodeHelpTranslation(help: NodeHelp, locale: string | undefined): NodeHelpTranslation | undefined {
  const translations = help.translations
  if (!translations || !locale) return undefined

  const normalized = normalizeNodeHelpLocale(locale)
  return translations[normalized]
    ?? translations[normalized.split("-")[0] ?? ""]
    ?? (normalized.startsWith("zh") ? translations["zh-CN"] : undefined)
}

function normalizeNodeHelpLocale(locale: string): string {
  const normalized = locale.split(".")[0]?.replace(/_/g, "-").toLowerCase() ?? ""
  if (normalized === "zh" || normalized.startsWith("zh-cn") || normalized.startsWith("zh-hans")) return "zh-CN"
  if (normalized.startsWith("zh-tw") || normalized.startsWith("zh-hk") || normalized.startsWith("zh-hant")) return "zh-TW"
  if (normalized.startsWith("en")) return "en"
  return normalized
}

export interface HostComponentRef {
  id: string
  moduleId: string
  state?: string
  tags?: string[]
  hiddenIn?: Record<string, boolean>
  data?: Record<string, unknown>
}

export type { NodeRunEvent, NodeRunResult }

/**
 * Fine-grained capability domains surfaced by the host to nodes.
 * Mirrors the `vscode.commands` / `vscode.workspace` split: a node opts into
 * the domains it needs via {@link NodeHostRequirements.capabilities}, and the
 * host injects only those.
 */
export type NodeCapabilityId =
  | "contract"
  | "state"
  | "workspace"
  | "runner"
  | "clipboard"
  | "downloads"
  | "localFiles"
  | "config"
  | "env"

export interface NodeContractCapability {
  name: "xiranite.node-host"
  version: string
  supportedCapabilities: readonly NodeCapabilityId[]
  hasCapability: (capability: NodeCapabilityId) => boolean
}

export interface NodeStateCapability<TData extends Record<string, unknown> = Record<string, unknown>> {
  getData: () => TData | undefined
  patchData: (patch: Partial<TData>) => void
  replaceData?: (next: TData) => void
}

export interface NodeWorkspaceCapability {
  listComponents: () => HostComponentRef[]
  updateComponent: (compId: string, patch: Partial<HostComponentRef>) => void
}

export interface NodeRunnerCapability {
  run: <TInput = unknown, TData = unknown>(
    nodeId: string,
    input: TInput,
    onEvent?: (event: NodeRunEvent) => void,
  ) => Promise<NodeRunResult<TData>>
  /** Cancel the active backend operation associated with this component. */
  cancelCurrent?: () => Promise<boolean>
}

export interface NodeClipboardCapability {
  readText?: () => Promise<string>
  writeText?: (text: string) => Promise<void>
}

export interface NodeDownloadsCapability {
  text: (filename: string, content: string) => void
}

export interface NodeLocalFilesCapability {
  getUrl: (path: string) => string
  pickFiles?: () => Promise<string[]>
  pickDirectory?: () => Promise<string | undefined>
  list?: (path: string, options?: { recursive?: boolean; extensions?: string[]; limit?: number }) => Promise<Array<{ name: string; path: string; isDirectory: boolean; sizeBytes: number; lastModified: number; type: string }>>
  /** Subscribe to native desktop file drops routed to one explicit DOM target. */
  subscribeDrops?: (targetId: string, handler: (paths: string[]) => void) => Promise<() => void>
}

export interface NodePreset<TValues extends Record<string, unknown> = Record<string, unknown>> {
  id: string
  name: string
  values: TValues
}

export interface NodeConfigCapability<TConfig = unknown> {
  get: () => Promise<{ config: TConfig | undefined; path: string }>
  save: (config: TConfig) => Promise<void>
  getPresets?: <TValues extends Record<string, unknown> = Record<string, unknown>>() => Promise<{ presets: Array<NodePreset<TValues>> }>
  createPreset?: <TValues extends Record<string, unknown> = Record<string, unknown>>(input: { name: string; values: TValues }) => Promise<{ preset: NodePreset<TValues> }>
  updatePreset?: <TValues extends Record<string, unknown> = Record<string, unknown>>(presetId: string, input: { name?: string; values?: TValues }) => Promise<{ preset: NodePreset<TValues> }>
  deletePreset?: (presetId: string) => Promise<{ deleted: boolean }>
  getUi?: <TUiConfig = unknown>() => Promise<{ config: TUiConfig | undefined; path: string }>
  saveUi?: <TUiConfig = unknown>(config: TUiConfig) => Promise<void>
  openFile?: () => Promise<void> | void
}

export interface NodeEnvCapability {
  theme: "light" | "dark"
  platform: "web" | "electron" | "node" | string
}

export interface NodeHostCapabilities<
  TData extends Record<string, unknown> = Record<string, unknown>,
  TConfig = unknown,
> {
  contract: NodeContractCapability
  state: NodeStateCapability<TData>
  workspace?: NodeWorkspaceCapability
  runner?: NodeRunnerCapability
  clipboard?: NodeClipboardCapability
  downloads?: NodeDownloadsCapability
  localFiles?: NodeLocalFilesCapability
  config?: NodeConfigCapability<TConfig>
  env: NodeEnvCapability
}

/**
 * Minimal parse-compatible schema interface. Zod schemas satisfy this
 * structurally, but @xiranite/contract does not depend on Zod so package
 * authors can use any compatible validator.
 */
export interface NodeSchema<T> {
  parse: (value: unknown) => T
  safeParse?: (value: unknown) => { success: true; data: T } | { success: false; error: unknown }
}

export interface NodeSchemas<
  TData extends Record<string, unknown> = Record<string, unknown>,
  TConfig = unknown,
  TInput = unknown,
  TResult = unknown,
> {
  data?: NodeSchema<TData>
  config?: NodeSchema<TConfig>
  input?: NodeSchema<TInput>
  result?: NodeSchema<TResult>
}

export type NodeIsolationMode = "trusted" | "contained" | "iframe" | "worker"

export interface NodeHostRequirements {
  contractVersion?: string
  capabilities?: readonly NodeCapabilityId[]
  isolation?: NodeIsolationMode
}

export type NodeHostApi<
  TData extends Record<string, unknown> = Record<string, unknown>,
  TConfig = unknown,
> = NodeHostCapabilities<TData, TConfig> & {
  /**
   * Deprecated compatibility API. New components should use host.state.
   * Kept until all src/nodes/<id>/Component.tsx are migrated.
   * @deprecated use host.state.getData() / host.state.patchData()
   */
  getData: <T = TData>(compId: string) => T | undefined
  /** @deprecated use host.state.patchData() */
  patchData: (compId: string, patch: Partial<TData> & Record<string, unknown>) => void
  /** @deprecated use host.workspace */
  listComponents: () => HostComponentRef[]
  /** @deprecated use host.workspace */
  updateComponent: (compId: string, patch: Partial<HostComponentRef>) => void
  /** @deprecated use host.runner */
  actions?: {
    run?: NodeRunnerCapability["run"]
    cancelCurrent?: NodeRunnerCapability["cancelCurrent"]
  }
  /** @deprecated use host.downloads */
  downloadText?: (filename: string, content: string) => void
  /** @deprecated use host.config */
  getNodeConfig?: <T = TConfig>() => Promise<{ config: T | undefined; path: string }>
  /** @deprecated use host.config */
  saveNodeConfig?: <T = TConfig>(config: T) => Promise<void>
  /** @deprecated use host.config */
  getNodeUiConfig?: <T = unknown>() => Promise<{ config: T | undefined; path: string }>
  /** @deprecated use host.config */
  saveNodeUiConfig?: <T = unknown>(config: T) => Promise<void>
  /** @deprecated use host.config */
  openConfigFile?: () => Promise<void> | void
}

export interface NodeComponentProps<
  TData extends Record<string, unknown> = Record<string, unknown>,
  TConfig = unknown,
> {
  compId: string
  host: NodeHostApi<TData, TConfig>
}

export type NodeComponent<
  TData extends Record<string, unknown> = Record<string, unknown>,
  TConfig = unknown,
> = (props: NodeComponentProps<TData, TConfig>) => unknown

export interface HeadlessNodePackage<TCore extends Record<string, unknown> = Record<string, unknown>> {
  def: NodeDef
  core: TCore
}

export interface AppNodeEntry<
  TCore extends Record<string, unknown> = Record<string, unknown>,
  TData extends Record<string, unknown> = Record<string, unknown>,
  TConfig = unknown,
> extends HeadlessNodePackage<TCore> {
  Component: NodeComponent<TData, TConfig>
  host?: NodeHostRequirements
  schemas?: NodeSchemas<TData, TConfig>
}

export type NodeEntry<TCore extends Record<string, unknown> = Record<string, unknown>> = AppNodeEntry<TCore>
