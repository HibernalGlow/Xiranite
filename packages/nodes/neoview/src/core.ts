import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { FrameSnapshot, ReaderLayout } from "./frame.js"

export type ReaderSessionId = string
export type PageId = string
export type ReaderGeneration = number
export type ReadingDirection = "left-to-right" | "right-to-left"
export type TailOverflowBehavior = "do-nothing" | "stay-on-last-page" | "next-book" | "loop" | "seamless-loop"

export type ViewSource =
  | { kind: "directory"; path: string }
  | { kind: "archive"; path: string; entryPath?: string }
  | { kind: "image"; path: string }
  | { kind: "document"; path: string; format: "pdf" | "epub" }

export type PageMediaKind = "image" | "animated-image" | "video" | "document-page"

export interface PageDimensions {
  width: number
  height: number
}

export interface ReaderPage {
  id: PageId
  index: number
  name: string
  sourcePath: string
  entryPath?: string
  mediaKind: PageMediaKind
  mimeType?: string
  byteLength?: number
  dimensions?: PageDimensions
}

export interface ReaderBook {
  id: string
  source: ViewSource
  displayName: string
  pages: readonly ReaderPage[]
}

export interface ReaderSessionOptions {
  direction: ReadingDirection
  layout: ReaderLayout
  tailOverflow: TailOverflowBehavior
}

export const DEFAULT_READER_SESSION_OPTIONS: ReaderSessionOptions = {
  direction: "left-to-right",
  layout: {
    pageMode: "single",
    panorama: false,
    singleFirstPage: true,
    singleLastPage: true,
    treatWidePageAsSingle: true,
  },
  tailOverflow: "stay-on-last-page",
}

export type ReaderSessionEvent =
  | { type: "frame"; snapshot: FrameSnapshot }
  | { type: "pages-changed"; pages: readonly ReaderPage[]; generation: ReaderGeneration }
  | { type: "error"; code: string; message: string; recoverable: boolean }
  | { type: "closed"; sessionId: ReaderSessionId }

export interface ReaderSession extends AsyncDisposable {
  readonly id: ReaderSessionId
  readonly book: ReaderBook
  readonly generation: ReaderGeneration
  snapshot(): FrameSnapshot
  goTo(pageIndex: number, signal?: AbortSignal): Promise<FrameSnapshot>
  next(signal?: AbortSignal): Promise<FrameSnapshot>
  previous(signal?: AbortSignal): Promise<FrameSnapshot>
  updateOptions(options: Partial<ReaderSessionOptions>): FrameSnapshot
  subscribe(listener: (event: ReaderSessionEvent) => void): () => void
  close(): Promise<void>
}

export interface OpenViewSourceOptions extends Partial<ReaderSessionOptions> {
  initialPage?: number
  signal?: AbortSignal
}

export interface ReaderService extends AsyncDisposable {
  openViewSource(source: ViewSource, options?: OpenViewSourceOptions): Promise<ReaderSession>
  getSession(sessionId: ReaderSessionId): ReaderSession | undefined
  closeSession(sessionId: ReaderSessionId): Promise<void>
}

export interface NeoViewInput {
  action?: "status"
}

export interface NeoViewRuntime {
  migrationStatus: () => Promise<NeoViewMigrationStatus>
}

export interface NeoViewMigrationStatus {
  sourceRevision: string
  featureCount: number
  pendingFeatures: number
  readerCoreReady: boolean
}

export interface NeoViewNodeData {
  migration: NeoViewMigrationStatus
}

export async function runNeoview(
  input: NeoViewInput,
  runtime: NeoViewRuntime,
  onEvent: (event: NodeRunEvent) => void,
): Promise<NodeRunResult<NeoViewNodeData>> {
  if ((input.action ?? "status") !== "status") {
    return { success: false, message: "NeoView reader execution is not enabled until ReaderSession and ArchiveProvider are complete." }
  }
  const migration = await runtime.migrationStatus()
  onEvent({ type: "log", message: `NeoView migration: ${migration.pendingFeatures}/${migration.featureCount} features pending.` })
  return {
    success: true,
    message: migration.readerCoreReady ? "NeoView reader core contracts are ready." : "NeoView migration status loaded.",
    data: { migration },
  }
}
