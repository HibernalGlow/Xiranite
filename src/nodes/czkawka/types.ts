import type { CzkawkaCheckMethod, CzkawkaData, CzkawkaHashType, CzkawkaImageHashAlgorithm, CzkawkaImageResizeAlgorithm, CzkawkaMusicCheckType, CzkawkaSort, CzkawkaTool, CzkawkaVideoCropDetect } from "@xiranite/node-czkawka/core"

export type CzkawkaPhase = "idle" | "running" | "completed" | "error"
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
  sortBy?: CzkawkaSort
  descending?: boolean
  dryRun?: boolean
  destinationDirectory?: string
  outputPath?: string
  phase?: CzkawkaPhase
  progress?: number
  progressText?: string
  result?: CzkawkaData | null
  operation?: CzkawkaData | null
}
