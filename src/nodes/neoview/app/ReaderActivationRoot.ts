import type { ReaderActivationProvenanceDto } from "../adapters/reader-http-client"

/**
 * The activation root is the filesystem entry the user chose to open. A
 * penetration terminal is only the Reader source, never the deletion target.
 */
export function resolveReaderActivationRootPath(
  sourcePath: string,
  provenance?: ReaderActivationProvenanceDto,
  restoredActivationRootPath?: string,
): string {
  const source = sourcePath.trim()
  const selectedEntry = provenance?.browserOriginEntryPath.trim()
  if (selectedEntry) return selectedEntry
  return restoredActivationRootPath?.trim() || source
}

/** A restored root belongs only to the persisted Reader source. */
export function isSameReaderPath(left: string, right: string): boolean {
  const normalize = (value: string) => value.trim().replaceAll("\\", "/").replace(/\/+$/u, "")
  const normalizedLeft = normalize(left)
  const normalizedRight = normalize(right)
  return /^[a-z]:/iu.test(normalizedLeft) || /^[a-z]:/iu.test(normalizedRight)
    ? normalizedLeft.toLocaleLowerCase("en-US") === normalizedRight.toLocaleLowerCase("en-US")
    : normalizedLeft === normalizedRight
}

export function restoredReaderActivationRootForPath(
  initialPath: string,
  sourcePath: string,
  activationRootPath: string | undefined,
): string | undefined {
  return isSameReaderPath(initialPath, sourcePath) ? activationRootPath : undefined
}

export type ReaderPathCommittedCallback = (path: string, browserOriginPath?: string, activationRootPath?: string) => void

export interface ReaderAppActivationRootProps {
  initialActivationRootPath?: string
  onPathCommitted?: ReaderPathCommittedCallback
}

/** Avoid storing redundant state for ordinary opens while clearing stale roots. */
export function notifyReaderPathCommitted(
  callback: ReaderPathCommittedCallback | undefined,
  path: string,
  browserOriginPath: string | undefined,
  activationRootPath: string | undefined,
): void {
  if (!callback) return
  const source = path.trim()
  const root = activationRootPath?.trim()
  if (source && root && !isSameReaderPath(source, root)) {
    callback(path, browserOriginPath, root)
    return
  }
  callback(path, browserOriginPath)
}
