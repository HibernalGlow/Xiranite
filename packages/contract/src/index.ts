import type { ComponentType } from "react"

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
  env: {
    theme: "light" | "dark"
    platform: "web" | "electron" | "node" | string
  }
}

export interface NodeComponentProps {
  compId: string
  host: NodeHostApi
}

export interface NodeEntry<TCore extends Record<string, unknown> = Record<string, unknown>> {
  def: NodeDef
  Component: ComponentType<NodeComponentProps>
  core: TCore
}
