import type { ReaderPage } from "../page/page.js"

export type ViewSource =
  | { kind: "directory"; path: string }
  | { kind: "archive"; path: string; entryPath?: string }
  | { kind: "image"; path: string }
  | { kind: "document"; path: string; format: "pdf" | "epub" }

export interface ReaderBook {
  id: string
  source: ViewSource
  displayName: string
  pages: readonly ReaderPage[]
}
