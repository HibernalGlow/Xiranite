import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export interface NeoxidePageImageResult {
  data: Buffer
  mimeType: string
}

export interface NeoxideNativeBinding {
  readerOpen(path: string): any
  readerNavigate(sessionId: string, action: string): any
  readerGoto(sessionId: string, pageIndex: number): any
  readerListPages(sessionId: string, cursor: number, limit: number): any
  readerFrameWindow(sessionId: string, centerIndex: number, radius: number): any
  readerGetPageBytes(sessionId: string, pageIndex: number): NeoxidePageImageResult
  readerClose(sessionId: string): void
  readerOpenDirectoryBrowser(path: string): any
  readerListRecent(offset: number, limit: number): any
  readerRemoveRecent(bookId: string): void
  readerListBookmarks(offset: number, limit: number): any
  readerSaveBookmark(bookmark: any): any
  readerRemoveBookmark(id: string): void
  readerGetConfig(): any
  readerUpdateConfig(patch: any): any
}

let cachedBinding: NeoxideNativeBinding | null = null
let probeAttempted = false

export function getNeoxideNativeBinding(): NeoxideNativeBinding | null {
  if (cachedBinding) return cachedBinding
  if (probeAttempted) return null
  probeAttempted = true

  const thisDir = dirname(fileURLToPath(import.meta.url))
  const workspaceRoot = resolve(thisDir, "../../../../../")

  const candidates = [
    // 1. Environment override
    process.env.XIRANITE_NEOXIDE_NATIVE_PATH,
    // 2. Standard Xiranite native artifacts directory
    join(workspaceRoot, "native", "artifacts", `${process.platform}-${process.arch}`, `xiranite-neoxide.${process.platform}-${process.arch}.node`),
    // 3. vendor/neoxide target release paths
    join(workspaceRoot, "vendor", "neoxide", "target", "release", "xiranite_neoxide_node.node"),
    join(workspaceRoot, "vendor", "neoxide", "target", "release", "xiranite_neoxide_node.dll"),
  ].filter(Boolean) as string[]

  const req = createRequire(import.meta.url)
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        cachedBinding = req(candidate) as NeoxideNativeBinding
        return cachedBinding
      } catch (err) {
        console.warn(`[neoview] Found native binding at ${candidate}, but failed to load:`, err)
      }
    }
  }

  return null
}

export function isNeoxideNativeAvailable(): boolean {
  return getNeoxideNativeBinding() !== null
}
