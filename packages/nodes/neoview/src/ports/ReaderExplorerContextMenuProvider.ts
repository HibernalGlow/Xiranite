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
  hives?: readonly ReaderExplorerContextMenuHive[]
}

export interface ReaderExplorerContextMenuPlanItem {
  entryKey: string
  hive: ReaderExplorerContextMenuHive
  scope: ReaderExplorerContextMenuScope
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
  reason?: string
}

export interface ReaderExplorerContextMenuProvider {
  preview(signal?: AbortSignal): Promise<ReaderExplorerContextMenuPreview>
  status(signal?: AbortSignal): Promise<ReaderExplorerContextMenuStatus>
  setEnabled(enabled: boolean, signal?: AbortSignal): Promise<ReaderExplorerContextMenuStatus>
}
