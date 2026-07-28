import { useCallback, useEffect, useState } from "react"

import type { ReaderActivationTraversalFrameDto } from "../../../../adapters/reader-http-client"
import { sameFolderPath } from "./FolderPathIdentity"

export interface FolderInlineBranchState {
  anchorPath: string
  contentPath: string
  traversalFrames: readonly ReaderActivationTraversalFrameDto[]
}

export function useFolderInlineBranchState(enabled: boolean) {
  const [inlineBranch, setInlineBranch] = useState<FolderInlineBranchState>()
  const closeInlineBranch = useCallback(() => setInlineBranch(undefined), [])
  const toggleInlineBranch = useCallback((
    path?: string,
    traversalFrames?: readonly ReaderActivationTraversalFrameDto[],
    preserveAnchor = false,
  ) => {
    setInlineBranch((current) => {
      if (path === undefined || !traversalFrames?.length) return undefined
      if (!preserveAnchor && sameFolderPath(current?.anchorPath ?? "", path)) return undefined
      return {
        anchorPath: preserveAnchor
          ? current?.anchorPath ?? traversalFrames[0]?.currentEntryPath ?? path
          : path,
        contentPath: path,
        traversalFrames: traversalFrames.map((frame) => ({ ...frame })),
      }
    })
  }, [])

  useEffect(() => {
    if (!enabled) closeInlineBranch()
  }, [closeInlineBranch, enabled])

  return { inlineBranch, closeInlineBranch, toggleInlineBranch }
}
