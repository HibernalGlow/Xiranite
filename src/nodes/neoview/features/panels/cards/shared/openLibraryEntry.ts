import type {
  ReaderActivationProvenanceDto,
  ReaderFolderPenetrationConfig,
  ReaderFolderPenetrationResolutionDto,
  ReaderHttpClient,
} from "../../../../adapters/reader-http-client"
import { libraryItemFolderPath } from "./libraryItemFolderPath"

export type LibraryEntryKind = "file" | "folder"

export interface OpenLibraryEntryOptions {
  client: ReaderHttpClient
  path: string
  kind: LibraryEntryKind
  name?: string
  penetration?: ReaderFolderPenetrationConfig
  onOpen?(path: string, provenance?: ReaderActivationProvenanceDto): void | Promise<void>
  onBrowsePath?(path: string): void
  /** Prefer File Card activation when a browser session can handle the same path. Returns true if handled. */
  onActivateInFolderCard?(path: string): boolean | void
  onResolved?(resolution: ReaderFolderPenetrationResolutionDto): void
  onError?(message: string): void
}

/**
 * Open a History/Bookmark entry with the same penetration semantics as File Card.
 * Folder targets prefer the live File Card when available so browser session identity
 * stays shared; otherwise a short-lived browser session is used for resolve only.
 */
export async function openLibraryEntry(options: OpenLibraryEntryOptions): Promise<void> {
  const path = options.path.trim()
  if (!path) return

  if (options.kind === "file") {
    const browserOriginPath = libraryItemFolderPath(path, false)
    options.onBrowsePath?.(browserOriginPath)
    await options.onOpen?.(path, {
      browserOriginPath,
      browserOriginEntryPath: path,
    })
    return
  }

  const parentPath = libraryItemFolderPath(path, false)
  const penetrationEnabled = Boolean(options.penetration?.enabled)

  if (!penetrationEnabled) {
    // Keep File Card on the parent so the book entry stays visible, and reopen the book.
    options.onBrowsePath?.(parentPath)
    await options.onOpen?.(path, {
      browserOriginPath: parentPath,
      browserOriginEntryPath: path,
    })
    return
  }

  // Same-origin reuse: let the live File Card own click/activation identity.
  if (options.onActivateInFolderCard?.(path) === true) return

  // No live File Card (or it declined) — resolve via a temporary browser session when available.
  if (!options.client.resolveFolderPenetration) {
    options.onBrowsePath?.(path)
    return
  }
  const resolution = await resolveLibraryFolderPenetration(options.client, path, options.penetration!)
  if (!resolution) {
    options.onBrowsePath?.(path)
    return
  }
  options.onResolved?.(resolution)
  await applyFolderPenetrationResolution({
    originPath: path,
    parentPath,
    name: options.name,
    resolution,
    onOpen: options.onOpen,
    onBrowsePath: options.onBrowsePath,
    onError: options.onError,
  })
}

export async function resolveLibraryFolderPenetration(
  client: ReaderHttpClient,
  path: string,
  penetration: ReaderFolderPenetrationConfig,
  signal?: AbortSignal,
): Promise<ReaderFolderPenetrationResolutionDto | undefined> {
  if (!client.resolveFolderPenetration || !client.openDirectoryBrowser) return undefined
  const parentPath = libraryItemFolderPath(path, false)
  let sessionId: string | undefined
  try {
    const page = await client.openDirectoryBrowser(parentPath || path, signal)
    sessionId = page.sessionId
    return await client.resolveFolderPenetration(
      page.sessionId,
      path,
      {
        maxDepth: penetration.maxDepth,
        terminalTargets: penetration.terminalTargets,
      },
      signal,
    )
  } catch {
    return undefined
  } finally {
    if (sessionId) void client.closeDirectoryBrowser?.(sessionId).catch(() => undefined)
  }
}

export async function applyFolderPenetrationResolution(options: {
  originPath: string
  parentPath: string
  name?: string
  resolution: ReaderFolderPenetrationResolutionDto
  onOpen?(path: string, provenance?: ReaderActivationProvenanceDto): void | Promise<void>
  onBrowsePath?(path: string): void
  onError?(message: string): void
}): Promise<void> {
  const { resolution, originPath, parentPath } = options
  if (resolution.status === "resolved" && resolution.terminal) {
    const mixedMedia = resolution.reason === "mixed-media-directory"
    options.onBrowsePath?.(parentPath)
    await options.onOpen?.(resolution.terminal.path, {
      browserOriginPath: parentPath,
      browserOriginEntryPath: originPath,
      ...(mixedMedia ? { browserOriginSelfTerminal: true } : {}),
    })
    return
  }
  if (resolution.status === "blocked" && (resolution.reason === "permission" || resolution.reason === "cycle")) {
    options.onError?.(
      resolution.reason === "permission" ? "没有读取权限" : "检测到目录循环",
    )
    return
  }
  // branch / empty / depth-limit → enter the original folder in File Card.
  options.onBrowsePath?.(originPath)
}
