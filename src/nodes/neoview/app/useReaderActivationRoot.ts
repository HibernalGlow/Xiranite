import { useRef } from "react"

import type { ReaderActivationProvenanceDto } from "../adapters/reader-http-client"
import {
  notifyReaderPathCommitted,
  resolveReaderActivationRootPath,
  restoredReaderActivationRootForPath,
  type ReaderPathCommittedCallback,
} from "./ReaderActivationRoot"

export function useReaderActivationRoot({
  initialPath,
  initialActivationRootPath,
  onPathCommitted,
}: {
  initialPath: string
  initialActivationRootPath?: string
  onPathCommitted?: ReaderPathCommittedCallback
}) {
  const activationRootPathRef = useRef(resolveReaderActivationRootPath(initialPath, undefined, initialActivationRootPath))
  const initialPathRef = useRef(initialPath)
  const initialOpenPendingRef = useRef(true)
  const onPathCommittedRef = useRef(onPathCommitted)
  onPathCommittedRef.current = onPathCommitted

  function activationRootForOpen(sourcePath: string, provenance?: ReaderActivationProvenanceDto): string {
    return resolveReaderActivationRootPath(
      sourcePath,
      provenance,
      initialOpenPendingRef.current
        ? restoredReaderActivationRootForPath(initialPathRef.current, sourcePath, activationRootPathRef.current)
        : undefined,
    )
  }

  function commitOpenedPath(sourcePath: string, browserOriginPath: string | undefined, activationRootPath: string): void {
    activationRootPathRef.current = activationRootPath
    initialOpenPendingRef.current = false
    notifyReaderPathCommitted(onPathCommittedRef.current, sourcePath, browserOriginPath, activationRootPath)
  }

  function commitPath(sourcePath: string, browserOriginPath: string | undefined): void {
    notifyReaderPathCommitted(onPathCommittedRef.current, sourcePath, browserOriginPath, activationRootPathRef.current)
  }

  return { activationRootPathRef, activationRootForOpen, commitOpenedPath, commitPath }
}
