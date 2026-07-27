export type ReaderExplorerContextMenuHive = "HKCU" | "HKCR" | "HKLM"
export type ReaderExplorerContextMenuScope = "file" | "directory" | "background"

/** A portable description of the Explorer registration owned by the host. */
export interface ReaderExplorerContextMenuRegistration {
  key: string
  label: string
  executable: string
  arguments?: readonly string[]
  icon?: string
  scopes?: readonly ReaderExplorerContextMenuScope[]
  /** File verbs are registered only for these extensions; omit for legacy *. */
  extensions?: readonly string[]
  hives?: readonly ReaderExplorerContextMenuHive[]
}

export interface ReaderExplorerContextMenuPlanItem {
  entryKey: string
  hive: ReaderExplorerContextMenuHive
  scope: ReaderExplorerContextMenuScope
  extension?: string
  registryPath: string
  label: string
  icon: string
  command: string
  enabled: boolean
}

export interface ReaderExplorerContextMenuPreview {
  available: boolean
  plan: readonly ReaderExplorerContextMenuPlanItem[]
  registryFile: string
  reason?: string
}

export interface ReaderExplorerContextMenuStatus {
  available: boolean
  enabled: boolean
  state?: "disabled" | "registered" | "needs-repair" | "conflict" | "unavailable"
  reason?: string
}

export interface ReaderExplorerContextMenuProvider {
  preview(signal?: AbortSignal): Promise<ReaderExplorerContextMenuPreview>
  status(signal?: AbortSignal): Promise<ReaderExplorerContextMenuStatus>
  setEnabled(enabled: boolean, signal?: AbortSignal): Promise<ReaderExplorerContextMenuStatus>
  reconcile?(signal?: AbortSignal): Promise<ReaderExplorerContextMenuStatus>
}
