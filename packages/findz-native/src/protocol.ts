export const FINDZ_ABI_VERSION = 1
export const FINDZ_REQUEST_VERSION = 1

export interface FindzError {
  code: string
  message: string
  retryable: boolean
  details?: unknown
}

export type FindzResponse<T> =
  | { ok: true; requestId?: string; result: T }
  | { ok: false; requestId?: string; error: FindzError }

export interface FindzApiInfo {
  abiVersion: number
  coreVersion: string
  requestVersions: number[]
  capabilities: string[]
  supportedFormats: string[]
}

export interface FindzRequest<TParams> {
  requestVersion: typeof FINDZ_REQUEST_VERSION
  requestId: string
  method: string
  params: TParams
}

export interface FindzLibraryOpenParams {
  libraryId?: string
  root: string
  databasePath?: string
}

export interface FindzLibrarySummary {
  libraryId: string
  root: string
  databasePath: string
  archiveCount: number
  memberCount: number
  watcherHealth: string
  analysisPolicy: string
}

export interface FindzTask {
  id: string
  libraryId: string
  kind: "scan" | "watcher" | "analysis"
  status: "queued" | "running" | "paused" | "completed" | "completed_with_warnings" | "cancelled" | "failed"
  totalArchives: number
  doneArchives: number
  totalMembers: number
  doneMembers: number
  skippedMembers: number
  failedMembers: number
  startedAt?: string
  finishedAt?: string
  message: string
  analysisPolicy?: string
}

export interface FindzAnalysisScope {
  kind: "all" | "archives" | "members"
  archiveIds?: number[]
  memberIds?: number[]
  deepRetry?: boolean
}

export interface FindzPage {
  cursor?: string
  limit?: number
}

export interface FindzRuleCondition {
  id: string
  kind: "condition"
  field: string
  operator: string
  value?: string | number | boolean | null | Array<string | number | boolean | null>
}

export interface FindzRuleGroup {
  id: string
  kind: "group"
  combinator: "all" | "any"
  not: boolean
  children: Array<FindzRuleCondition | FindzRuleGroup>
}

export interface FindzRuleTree {
  format: "xiranite-rule-tree/v1"
  version: 1
  root: FindzRuleGroup
}

export interface FindzArchiveQuery {
  libraryId: string
  text?: string
  pathPrefix?: string
  rules?: FindzRuleTree
  sortBy?: string
  sortDesc?: boolean
  page?: FindzPage
}

export interface FindzArchiveRow {
  id: number
  relativePath: string
  size: number
  modifiedAt: string
  scanState: string
  errorCode?: string
  memberCount: number
  imageMemberCount: number
  analyzedImageCount: number
  compressedImageBytes: number
  averageImageBytes: number
  averageBytesPerMegapixel: number
  medianBytesPerMegapixel: number
  anomalyCount: number
  estimatedSavingsBytes: number
}

export interface FindzMemberRow {
  id: number
  archiveId: number
  memberPath: string
  compressedSize: number
  uncompressedSize: number
  compressionMethod: number
  crc32: number
  extension: string
  imageCandidate: boolean
  nestedArchive: boolean
  encrypted: boolean
  actualFormat?: string
  width?: number
  height?: number
  pixels?: number
  bytesPerMegapixel?: number
  metadataStatus?: string
  metadataErrorCode?: string
  anomalyKind?: string
  anomalyScore?: number
  estimatedSavingsBytes: number
}

export interface FindzPagedResult<T> {
  items: T[]
  nextCursor?: string
  total: number
}

export interface FindzTreemapNode {
  id: string
  name: string
  value: number
  color: number
  archiveId?: number
  children?: FindzTreemapNode[]
}

export interface FindzNativeClient {
  getApiInfo(): Promise<FindzApiInfo>
  openLibrary(params: FindzLibraryOpenParams): Promise<FindzLibrarySummary>
  closeLibrary(libraryId: string): Promise<void>
  startScan(libraryId: string): Promise<FindzTask>
  applyWatcherChanges(libraryId: string, changes: Array<{ path: string; type: string }>): Promise<FindzTask>
  setWatcherHealth(libraryId: string, health: "healthy" | "degraded"): Promise<FindzLibrarySummary>
  startAnalysis(libraryId: string, scope?: FindzAnalysisScope): Promise<FindzTask>
  getTask(libraryId: string, taskId: string): Promise<FindzTask>
  pauseTask(libraryId: string, taskId: string): Promise<FindzTask>
  resumeTask(libraryId: string, taskId: string): Promise<FindzTask>
  cancelTask(libraryId: string, taskId: string): Promise<FindzTask>
  queryArchives(params: FindzArchiveQuery): Promise<FindzPagedResult<FindzArchiveRow>>
  exportRows(params: FindzArchiveQuery): Promise<FindzPagedResult<FindzArchiveRow>>
  queryMembers(params: { libraryId: string; archiveId: number; text?: string; page?: FindzPage }): Promise<FindzPagedResult<FindzMemberRow>>
  getTreemap(params: { libraryId: string; text?: string; pathPrefix?: string; rules?: FindzRuleTree; areaBy?: string }): Promise<FindzTreemapNode>
  close(): void
}
