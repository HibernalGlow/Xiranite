export type ReaderFolderPenetrationTerminalKindDto = "archive" | "document" | "media-directory" | "file"

export interface ReaderFolderPenetrationConfig {
  enabled: boolean
  expandBranchesInline: boolean
  inlineBranchLimitsEnabled: boolean
  inlineBranchMaxDirectories: number
  inlineBranchMaxFiles: number
  inlineBranchMaxItems: number
  showInternalFiles: boolean
  internalItemsMode: "single" | "all"
  maxDepth: number
  terminalTargets: ReaderFolderPenetrationTerminalKindDto[]
}
