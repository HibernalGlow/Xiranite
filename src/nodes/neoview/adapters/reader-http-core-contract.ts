import type { FrameSnapshot, PageDimensions, PageMediaKind } from "@xiranite/node-neoview/ui-core"

export interface ReaderPageDto {
  id: string
  index: number
  name: string
  mediaKind: PageMediaKind
  mimeType?: string
  byteLength?: number
  dimensions?: PageDimensions
  contentVersion: string
  assetUrl: string
  thumbnailUrl?: string
}
export interface ReaderActivationIdentityDto {
  readerSourcePath: string
  activatedEntryPath: string
  traversalRootPath: string
  traversalFrames?: readonly ReaderActivationTraversalFrameDto[]
  selfTerminal?: boolean
}
export interface ReaderActivationTraversalFrameDto {
  directoryPath: string
  currentEntryPath: string
  selfTerminal?: boolean
}
export interface ReaderSessionDto {
  sessionId: string
  activationIdentity: ReaderActivationIdentityDto
  book: { id: string; displayName: string; pageCount: number }
  frame: FrameSnapshot
  visiblePages: ReaderPageDto[]
  pageOrder?: ReaderPageOrderDto
  preload?: ReaderPreloadPlanDto
}
export interface ReaderNavigationDto {
  frame: FrameSnapshot
  visiblePages: ReaderPageDto[]
  pageOrder?: ReaderPageOrderDto
  preload?: ReaderPreloadPlanDto
}
export type ReaderPreloadOutcomeDto = "started" | "ready" | "failed" | "cancelled" | "evicted"
export interface ReaderPreloadCandidateDto {
  tier: "near" | "ahead" | "background"
  priority: "interactive" | "view" | "ahead" | "background"
  anchorPageIndex: number
  pageIndexes: number[]
  pageIds: string[]
}
export interface ReaderPreloadPlanDto {
  generation: number
  frameGeneration: number
  direction: "forward" | "backward"
  directionConfidence: number
  mode: "paged" | "continuous" | "scrub"
  admission: "normal" | "reduced" | "paused"
  velocityPagesPerSecond: number
  stableForMs: number
  focused: boolean
  queueWaitMs: number
  memoryPressure: "normal" | "elevated" | "critical"
  currentPageIndexes: number[]
  candidates: ReaderPreloadCandidateDto[]
}
export interface ReaderPreloadEventDto {
  pageId: string
  outcome: ReaderPreloadOutcomeDto
  metrics?: {
    ttfbMs?: number
    decodeMs?: number
    retainedBytes?: number
    activeLeases?: number
  }
}
export interface ReaderPreloadReportResultDto {
  generation: number
  accepted: number
  rejected: number
  stale: number
}
export interface ReaderPreloadContextDto {
  mode?: "paged" | "continuous" | "scrub"
  velocityPagesPerSecond?: number
  stableForMs?: number
  focused?: boolean
}
export interface ReaderSourceChangeDto {
  revision: number
  state: "changed" | "unavailable"
  kinds: Array<"create" | "update" | "delete">
  count: number
}
export type ReaderPageSortModeDto =
  "fileName" | "fileNameDescending" | "fileSize" | "fileSizeDescending" | "timeStamp" | "timeStampDescending" | "entry" | "entryDescending" | "random"
export type ReaderMediaPriorityModeDto = "none" | "videoFirst" | "imageFirst"
export interface ReaderPageOrderDto {
  sortMode: ReaderPageSortModeDto
  mediaPriority: ReaderMediaPriorityModeDto
  randomSeed?: string
}
export interface ReaderBookSettingsSnapshotDto {
  schemaVersion: 1
  bookId: string
  revision: number
  updatedAt?: number
  overrides: Partial<ReaderBookSettingsValuesDto>
  effective: ReaderBookSettingsValuesDto
  inherited: ReaderBookSettingsKeyDto[]
}
export interface ReaderBookSettingsValuesDto {
  favorite: boolean
  rating: number
  direction: "left-to-right" | "right-to-left"
  pageMode: "single" | "double"
  horizontalBook: boolean
}
export type ReaderBookSettingsKeyDto = keyof ReaderBookSettingsValuesDto
export type ReaderBookSettingsPatchDto = Partial<{
  [Key in ReaderBookSettingsKeyDto]: ReaderBookSettingsValuesDto[Key] | null
}>
export interface ReaderBookSettingsUpdateDto extends ReaderNavigationDto {
  settings: ReaderBookSettingsSnapshotDto
}
export interface ReaderPageListDto {
  pages: ReaderPageDto[]
  nextCursor?: number
  total: number
}
export interface ReaderFrameWindowDto {
  frames: FrameSnapshot[]
  centerIndex: number
  radius: number
  visiblePages: ReaderPageDto[]
}
export interface ReaderPageCopyActionDto {
  path: string
  leaseToken?: string
  expiresAt?: number
}
export type ReaderFileMutationDto =
  | {
      kind: "copy" | "move" | "rename"
      sourcePath: string
      destinationPath: string
      overwrite?: boolean
    }
  | { kind: "delete" | "trash"; sourcePath: string }
  | { kind: "create-directory"; destinationPath: string }
export interface ReaderFileOperationResultDto {
  index: number
  operation: ReaderFileMutationDto
  status: "succeeded" | "failed" | "cancelled"
  errorCode?: string
  error?: string
}
export interface ReaderFileOperationBatchResultDto {
  results: ReaderFileOperationResultDto[]
  succeeded: number
  failed: number
  cancelled: number
  undoable: number
  undoId?: string
  undoPersisted?: boolean
}
export interface ReaderFileUndoStateDto {
  available: boolean
  count: number
  latestId?: string
  latestCreatedAt?: number
  supportedKinds: readonly ReaderFileMutationDto["kind"][]
  trashRestore: boolean
  persistent: boolean
  persistenceError?: string
}
export interface ReaderFileUndoResultDto {
  undoId?: string
  results: ReaderFileOperationResultDto[]
  succeeded: number
  failed: number
  remaining: number
  journalPersisted?: boolean
}
export interface ReaderFileUndoDiscardResultDto {
  undoId?: string
  discarded: boolean
  remaining: number
  journalPersisted?: boolean
}
