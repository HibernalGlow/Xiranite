export const NEOVIEW_FOLDER_PENETRATION_TARGETS = ["archive", "document", "media-directory", "file"] as const
export type NeoviewFolderPenetrationTarget = (typeof NEOVIEW_FOLDER_PENETRATION_TARGETS)[number]

export interface NeoviewFolderPenetrationConfig {
  enabled: boolean
  expandBranchesInline: boolean
  inlineBranchLimitsEnabled: boolean
  inlineBranchMaxDirectories: number
  inlineBranchMaxFiles: number
  inlineBranchMaxItems: number
  showInternalFiles: boolean
  internalItemsMode: "single" | "all"
  maxDepth: number
  terminalTargets: NeoviewFolderPenetrationTarget[]
}

export function createDefaultNeoviewFolderPenetrationConfig(): NeoviewFolderPenetrationConfig {
  return {
    enabled: false,
    expandBranchesInline: false,
    inlineBranchLimitsEnabled: true,
    inlineBranchMaxDirectories: 4,
    inlineBranchMaxFiles: 4,
    inlineBranchMaxItems: 4,
    showInternalFiles: true,
    internalItemsMode: "single",
    maxDepth: 3,
    terminalTargets: [...NEOVIEW_FOLDER_PENETRATION_TARGETS],
  }
}
