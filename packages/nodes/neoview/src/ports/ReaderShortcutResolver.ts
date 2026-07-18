export type ReaderShortcutResolutionStatus = "resolved" | "invalid" | "unavailable"

export interface ReaderShortcutResolution {
  status: ReaderShortcutResolutionStatus
  shortcutPath: string
  targetPath?: string
  targetKind?: "file" | "directory"
  reason?: string
}

export interface ReaderShortcutResolver {
  resolve(path: string, signal?: AbortSignal): Promise<ReaderShortcutResolution>
}
