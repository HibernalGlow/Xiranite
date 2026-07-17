import type { ReaderPage } from "../page/page.js"
import type { PageContent } from "../page/page-content.js"
import type { ReaderSubtitleFormat } from "../subtitle/subtitle.js"

export type ViewSource =
  | { kind: "path"; path: string }
  | { kind: "directory"; path: string }
  | { kind: "archive"; path: string; entryPath?: string; entryPaths?: readonly string[] }
  | { kind: "image"; path: string }
  | { kind: "media"; path: string }
  | { kind: "document"; path: string; format: "pdf" | "epub" }

export interface ReaderRuntimeResourceSnapshot {
  archiveProviders: number
  archiveIndexEntries: number
  archiveIndexPayloadBytes: number
  archiveActiveExtractions: number
}

export interface ReaderSubtitleAsset {
  id: string
  name: string
  sourcePath: string
  entryPath?: string
  format: ReaderSubtitleFormat
  byteLength: number
  contentVersion: string
  content: PageContent
}

export interface ReaderBook extends AsyncDisposable {
  id: string
  source: ViewSource
  displayName: string
  pages: readonly ReaderPage[]
  subtitleAssets?: readonly ReaderSubtitleAsset[]
  runtimeResources?(): ReaderRuntimeResourceSnapshot
  close(): Promise<void>
}
