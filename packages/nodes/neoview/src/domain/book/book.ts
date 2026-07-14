import type { ReaderPage } from "../page/page.js"

export type ViewSource =
  | { kind: "path"; path: string }
  | { kind: "directory"; path: string }
  | { kind: "archive"; path: string; entryPath?: string; entryPaths?: readonly string[] }
  | { kind: "image"; path: string }
  | { kind: "media"; path: string }
  | { kind: "document"; path: string; format: "pdf" | "epub" }

export interface ReaderBook extends AsyncDisposable {
  id: string
  source: ViewSource
  displayName: string
  pages: readonly ReaderPage[]
  close(): Promise<void>
}
