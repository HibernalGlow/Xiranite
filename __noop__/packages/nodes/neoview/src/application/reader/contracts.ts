import type { ReaderBook, ViewSource } from "../../domain/book/book.js"
import { DEFAULT_READER_LAYOUT, type FrameSnapshot, type ReaderGeneration, type ReaderLayout } from "../../domain/frame/frame.js"
import type { ReadingDirection, TailOverflowBehavior } from "../../domain/navigation/navigation.js"
import type { PageId, ReaderPage } from "../../domain/page/page.js"
import type { ArchivePasswordInput } from "../../ports/ReaderBookLoader.js"
import type { ReaderPreloadContext, ReaderPreloadPlan } from "../preloading/PreloadCoordinator.js"
import type { ReaderPreloadReport, ReaderPreloadReportResult, ReaderPreloadTelemetrySnapshot } from "../preloading/PreloadTelemetry.js"

export type ReaderSessionId = string

export interface ReaderSessionOptions {
  direction: ReadingDirection
  layout: ReaderLayout
  tailOverflow: TailOverflowBehavior
}

export const DEFAULT_READER_SESSION_OPTIONS: ReaderSessionOptions = {
  direction: "left-to-right",
  layout: { ...DEFAULT_READER_LAYOUT },
  tailOverflow: "stay-on-last-page",
}

export type ReaderSessionEvent =
  | { type: "frame"; snapshot: FrameSnapshot }
  | { type: "pages-changed"; pages: ReaderBook["pages"]; generation: ReaderGeneration }
  | { type: "error"; code: string; message: string; recoverable: boolean }
  | { type: "closed"; sessionId: ReaderSessionId }

export interface ReaderSession extends AsyncDisposable {
  readonly id: ReaderSessionId
  readonly book: ReaderBook
  readonly generation: ReaderGeneration
  snapshot(): FrameSnapshot
  preloadPlan(): ReaderPreloadPlan | undefined
  cancelSpeculativePreload(): ReaderPreloadPlan
  updatePreloadContext(context: ReaderPreloadContext): ReaderPreloadPlan
  preloadTelemetry(): ReaderPreloadTelemetrySnapshot
  reportPreload(report: ReaderPreloadReport): ReaderPreloadReportResult
  getPage(pageId: PageId): ReaderPage | undefined
  goTo(pageIndex: number, signal?: AbortSignal): Promise<FrameSnapshot>
  next(signal?: AbortSignal): Promise<FrameSnapshot>
  previous(signal?: AbortSignal): Promise<FrameSnapshot>
  updateOptions(options: Partial<ReaderSessionOptions>, signal?: AbortSignal): Promise<FrameSnapshot>
  subscribe(listener: (event: ReaderSessionEvent) => void): () => void
  close(): Promise<void>
}

export interface OpenViewSourceOptions extends Partial<ReaderSessionOptions> {
  initialPage?: number
  signal?: AbortSignal
  archivePasswords?: readonly ArchivePasswordInput[]
}

export interface ReaderService extends AsyncDisposable {
  openViewSource(source: ViewSource, options?: OpenViewSourceOptions): Promise<ReaderSession>
  getSession(sessionId: ReaderSessionId): ReaderSession | undefined
  closeSession(sessionId: ReaderSessionId): Promise<void>
}
