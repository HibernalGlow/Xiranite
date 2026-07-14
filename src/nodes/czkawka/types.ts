import type { CzkawkaCheckMethod, CzkawkaConflictPolicy, CzkawkaData, CzkawkaDeleteMode, CzkawkaExportScope, CzkawkaHashType, CzkawkaImageHashAlgorithm, CzkawkaImageResizeAlgorithm, CzkawkaMusicCheckType, CzkawkaSort, CzkawkaTool, CzkawkaVideoCropDetect } from "@xiranite/node-czkawka/core"
import type { CzkawkaFilterState, CzkawkaStoredFilterPreset } from "@xiranite/node-czkawka/filters"
import type { CzkawkaSelectionAssistantConfig } from "@xiranite/node-czkawka/selection-assistant"
import type { CzkawkaActivityLogEntry } from "@xiranite/node-czkawka/activity-log"
import type { CzkawkaCardLayout } from "@xiranite/node-czkawka/card-layout"
import type { CzkawkaFloatingPanelState } from "@xiranite/node-czkawka/floating-panel"
import type { CzkawkaScanPreset } from "@xiranite/node-czkawka/scan-presets"

export type CzkawkaPhase = "idle" | "running" | "completed" | "stopped" | "error"
export type CzkawkaPanel = "source" | "results" | "analysis"

export interface CzkawkaCardState {
  tool?: CzkawkaTool
  includedDirectoriesText?: string
  includedDirectoriesReferencedText?: string
  excludedDirectoriesText?: string
  excludedItemsText?: string
  allowedExtensions?: string
  excludedExtensions?: string
  minimumFileSize?: string
  maximumFileSize?: string
  recursive?: boolean
  useCache?: boolean
  threadCount?: string
  checkMethod?: CzkawkaCheckMethod
  hashType?: CzkawkaHashType
  caseSensitiveNames?: boolean
  ignoreHardLinks?: boolean
  usePrehash?: boolean
  duplicateMinimumGroupSize?: string
  numberOfFiles?: string
  biggestFirst?: boolean
  similarity?: string
  similarImagesHashSize?: string
  similarImagesHashAlgorithm?: CzkawkaImageHashAlgorithm
  similarImagesResizeAlgorithm?: CzkawkaImageResizeAlgorithm
  similarImagesIgnoreSameSize?: boolean
  similarImagesFolderThreshold?: string
  similarVideosIgnoreSameSize?: boolean
  similarVideosSkipForward?: string
  similarVideosHashDuration?: string
  similarVideosCropDetect?: CzkawkaVideoCropDetect
  musicCheckType?: CzkawkaMusicCheckType
  musicApproximateComparison?: boolean
  musicCompareTitle?: boolean
  musicCompareArtist?: boolean
  musicCompareBitrate?: boolean
  musicCompareGenre?: boolean
  musicCompareYear?: boolean
  musicCompareLength?: boolean
  musicMaximumDifference?: string
  musicMinimumFragmentDuration?: string
  musicCompareFingerprintsOnlyWithSimilarTitles?: boolean
  brokenAudio?: boolean
  brokenPdf?: boolean
  brokenArchive?: boolean
  brokenImage?: boolean
  filterText?: string
  filterStatesByTool?: Partial<Record<CzkawkaTool, CzkawkaFilterState>>
  filterPresets?: CzkawkaStoredFilterPreset[]
  selectionAssistantConfig?: CzkawkaSelectionAssistantConfig
  selectionAssistantOpen?: boolean
  previewPanelEnabledByTool?: Partial<Record<CzkawkaTool, boolean>>
  activityLog?: CzkawkaActivityLogEntry[]
  cardLayout?: CzkawkaCardLayout
  floatingAnalysisPanel?: CzkawkaFloatingPanelState
  scanPresets?: CzkawkaScanPreset[]
  activeScanPresetId?: string
  sortBy?: CzkawkaSort
  descending?: boolean
  dryRun?: boolean
  destinationDirectory?: string
  deleteMode?: CzkawkaDeleteMode
  copyMode?: boolean
  preserveStructure?: boolean
  conflictPolicy?: CzkawkaConflictPolicy
  organizeSubfolderTemplate?: string
  organizeSkipSingleFileFolders?: boolean
  outputPath?: string
  exportScope?: CzkawkaExportScope
  phase?: CzkawkaPhase
  progress?: number
  progressText?: string
  result?: CzkawkaData | null
  operation?: CzkawkaData | null
}
