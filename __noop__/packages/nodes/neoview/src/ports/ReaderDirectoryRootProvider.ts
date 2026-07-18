export type ReaderDirectoryRootKind = "fixed" | "removable" | "network" | "optical" | "ramdisk" | "system" | "unknown"

export interface ReaderDirectoryRoot {
  path: string
  label: string
  kind: ReaderDirectoryRootKind
  available: boolean
}

export interface ReaderDirectoryRootProvider {
  list(signal?: AbortSignal): Promise<readonly ReaderDirectoryRoot[]>
}
