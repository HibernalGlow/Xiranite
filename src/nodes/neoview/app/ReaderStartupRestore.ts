import type { ReaderStartupStateDto } from "../adapters/reader-http-client"

export interface ReaderStartupRestoreRequest {
  initialPath: string
  hasExternalOpenRequest: boolean
}

export function readerStartupRestorePath(
  state: ReaderStartupStateDto | undefined,
  request: ReaderStartupRestoreRequest,
): string | undefined {
  if (request.initialPath.trim() || request.hasExternalOpenRequest) return undefined
  const path = state?.lastBook?.source.path.trim()
  return path || undefined
}
