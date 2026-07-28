import { useCallback, useEffect, useState } from "react"

import type { ReaderActivationTraversalFrameDto } from "../../../../adapters/reader-http-client"
import { sameFolderPath } from "./FolderPathIdentity"

export interface FolderInlineBranchState {
  path: string
  traversalFrames: readonly ReaderActivationTraversalFrameDto[]
}

export function useFolderInlineBranchState(enabled: boolean) {
  const [inlineBranch, setInlineBranch] = useState<FolderInlineBranchState>()
  const closeInlineBranch = useCallback(() => setInlineBranch(undefined), [])
  const toggleInlineBranch = useCallback((
    path?: string,
    traversalFrames?: readonly ReaderActivationTraversalFrameDto[],
  ) => {
    setInlineBranch((current) => path === undefined || sameFolderPath(current?.path ?? "", path) || !traversalFrames?.length
      ? undefined
      : { path, traversalFrames: traversalFrames.map((frame) => ({ ...frame })) })
  }, [])

  useEffect(() => {
    if (!enabled) closeInlineBranch()
  }, [closeInlineBranch, enabled])

  return { inlineBranch, closeInlineBranch, toggleInlineBranch }
}
