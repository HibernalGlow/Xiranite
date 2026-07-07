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

export interface HostComponentRef {
  id: string
  moduleId: string
  state?: string
  tags?: string[]
  hiddenIn?: Record<string, boolean>
  data?: Record<string, unknown>
}

export interface NodeRunEvent {
  type: "progress" | "log"
  progress?: number
  message: string
}

export interface NodeRunResult<TData = unknown> {
  success: boolean
  message: string
  data?: TData
  stats?: Record<string, number>
  outputPath?: string
}

export interface NodeHostApi {
  getData: <T = Record<string, unknown>>(compId: string) => T | undefined
  patchData: (compId: string, patch: Record<string, unknown>) => void
  listComponents: () => HostComponentRef[]
  updateComponent: (id: string, patch: Partial<HostComponentRef>) => void
  actions?: {
    run?: <TInput = unknown, TData = unknown>(
      nodeId: string,
      input: TInput,
      onEvent?: (event: NodeRunEvent) => void,
    ) => Promise<NodeRunResult<TData>>
  }
  clipboard?: {
    readText?: () => Promise<string>
    writeText?: (text: string) => Promise<void>
  }
  downloadText?: (filename: string, content: string) => void
  localFiles?: {
    getUrl?: (path: string) => string
  }
  env: {
    theme: "light" | "dark"
    platform: "web" | "electron" | "node" | string
  }
  /** Read node defaults from xiranite.config.toml. */
  getNodeConfig?: <T = unknown>() => Promise<{ config: T | undefined; path: string }>
  /** Save node defaults to xiranite.config.toml. */
  saveNodeConfig?: <T = unknown>(config: T) => Promise<void>
  /** Open the config file in the system default editor through the local backend when available. */
  openConfigFile?: () => Promise<void> | void
}

export interface NodeComponentProps {
  compId: string
  host: NodeHostApi
}

export type NodeComponent = (props: NodeComponentProps) => unknown

export interface HeadlessNodePackage<TCore extends Record<string, unknown> = Record<string, unknown>> {
  def: NodeDef
  core: TCore
}

export interface AppNodeEntry<TCore extends Record<string, unknown> = Record<string, unknown>>
  extends HeadlessNodePackage<TCore> {
  Component: NodeComponent
}

export type NodeEntry<TCore extends Record<string, unknown> = Record<string, unknown>> = AppNodeEntry<TCore>
