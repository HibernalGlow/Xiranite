import { useRef } from "react"

import type { ReaderActivationIdentityDto, ReaderActivationProvenanceDto, ReaderSessionDto } from "../adapters/reader-http-client"
import {
  cloneReaderActivationIdentity,
  isSameReaderPath,
  legacyReaderActivationIdentity,
  readerActivationProvenanceFromIdentity,
  relocateReaderActivationIdentity,
  type ReaderActivationIdentityCommittedCallback,
} from "./ReaderActivationIdentity"

export function useReaderActivationIdentity({
  initialPath,
  initialBrowserOriginPath,
  initialActivationIdentity,
  onActivationIdentityCommitted,
}: {
  initialPath: string
  initialBrowserOriginPath?: string
  initialActivationIdentity?: ReaderActivationIdentityDto
  onActivationIdentityCommitted?: ReaderActivationIdentityCommittedCallback
}) {
  const restoredIdentity = initialActivationIdentity
    ? cloneReaderActivationIdentity(initialActivationIdentity)
    : legacyReaderActivationIdentity(initialPath, initialBrowserOriginPath)
  const activationIdentityRef = useRef<ReaderActivationIdentityDto>(restoredIdentity)
  const initialOpenPendingRef = useRef(true)
  const onCommittedRef = useRef(onActivationIdentityCommitted)
  onCommittedRef.current = onActivationIdentityCommitted

  function provenanceForOpen(
    sourcePath: string,
    provenance?: ReaderActivationProvenanceDto,
  ): ReaderActivationProvenanceDto | undefined {
    if (provenance) return provenance
    const restored = activationIdentityRef.current
    if (!initialOpenPendingRef.current || !isSameReaderPath(restored.readerSourcePath, sourcePath)) return undefined
    return readerActivationProvenanceFromIdentity(restored)
  }

  function commitOpenedSession(opened: ReaderSessionDto): void {
    commitIdentity(opened.activationIdentity)
  }

  function commitStandalonePath(sourcePath: string, traversalRootPath: string | undefined, activatedEntryPath: string): void {
    commitIdentity(legacyReaderActivationIdentity(sourcePath, traversalRootPath, activatedEntryPath))
  }

  function clear(): void {
    activationIdentityRef.current = legacyReaderActivationIdentity("")
    initialOpenPendingRef.current = false
    onCommittedRef.current?.(undefined)
  }

  function relocatePath(sourcePath: string, destinationPath: string): ReaderActivationIdentityDto {
    const current = activationIdentityRef.current
    const relocated = relocateReaderActivationIdentity(current, sourcePath, destinationPath)
    if (relocated !== current) commitIdentity(relocated)
    return relocated
  }

  function commitIdentity(identity: ReaderActivationIdentityDto): void {
    const committed = cloneReaderActivationIdentity(identity)
    activationIdentityRef.current = committed
    initialOpenPendingRef.current = false
    onCommittedRef.current?.(committed)
  }

  return {
    activationIdentityRef,
    provenanceForOpen,
    commitOpenedSession,
    commitStandalonePath,
    relocatePath,
    clear,
  }
}
