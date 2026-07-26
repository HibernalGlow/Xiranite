import { useEffect, useRef, useState, type RefObject } from "react"
import type { ListRange } from "react-virtuoso"

import type {
  ReaderFolderPenetrationConfig,
  ReaderFolderViewConfig,
  ReaderHttpClient,
} from "../../../../adapters/reader-http-client"
import {
  directoryEntryAt,
  folderErrorMessage,
  type DirectoryCatalog,
} from "./DirectoryCatalog"
import type { FolderViewMode } from "./FolderBrowserState"
import {
  folderViewShowsPenetrationFiles,
  type FolderPenetrationFileName,
} from "./FolderPenetrationFileNames"

export function useFolderPenetrationPipeline({
  client,
  configuredPenetration,
  onFolderView,
  catalog,
  catalogRef,
  visibleRangeRef,
  viewMode,
  reportError,
}: {
  client: ReaderHttpClient
  configuredPenetration: ReaderFolderPenetrationConfig
  onFolderView?: (patch: Partial<ReaderFolderViewConfig>) => void | Promise<void>
  catalog: DirectoryCatalog | undefined
  catalogRef: RefObject<DirectoryCatalog | undefined>
  visibleRangeRef: RefObject<ListRange>
  viewMode: FolderViewMode
  reportError(message: string): void
}) {
  const descriptionRequestRef = useRef<AbortController>()
  const descriptionSignatureRef = useRef("")
  const [penetration, setPenetration] = useState(configuredPenetration)
  const [descriptions, setDescriptions] = useState<ReadonlyMap<string, readonly FolderPenetrationFileName[]>>(() => new Map())

  const penetrationSyncKey = [
    configuredPenetration.enabled,
    configuredPenetration.showInternalFiles,
    configuredPenetration.internalItemsMode ?? "",
    configuredPenetration.maxDepth,
    configuredPenetration.terminalTargets.join(","),
  ].join(":")

  useEffect(() => {
    setPenetration((current) => {
      const next = configuredPenetration
      if (
        current.enabled === next.enabled
        && current.showInternalFiles === next.showInternalFiles
        && (current.internalItemsMode ?? "") === (next.internalItemsMode ?? "")
        && current.maxDepth === next.maxDepth
        && current.terminalTargets.join(",") === next.terminalTargets.join(",")
      ) return current
      return next
    })
    // The parent rebuilds this object; value changes are represented by penetrationSyncKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [penetrationSyncKey])

  useEffect(() => {
    requestDescriptions(visibleRangeRef.current)
  }, [penetration.enabled, penetration.showInternalFiles, viewMode, catalog?.sessionId, catalog?.generation])

  useEffect(() => () => descriptionRequestRef.current?.abort(), [])

  async function updatePenetration(patch: Partial<ReaderFolderPenetrationConfig>): Promise<void> {
    const previous = penetration
    const next = { ...previous, ...patch }
    if (!next.terminalTargets.length) return
    setPenetration(next)
    try {
      await onFolderView?.({ penetration: patch })
    } catch (cause) {
      setPenetration(previous)
      reportError(`保存穿透设置失败：${folderErrorMessage(cause)}`)
    }
  }

  function requestDescriptions(range: ListRange, source = catalogRef.current): void {
    if (
      !folderViewShowsPenetrationFiles(viewMode, penetration.enabled, penetration.showInternalFiles)
      || !client.describeFolderPenetration
      || !source
    ) {
      descriptionRequestRef.current?.abort()
      descriptionSignatureRef.current = ""
      setDescriptions((current) => current.size ? new Map() : current)
      return
    }
    const paths: string[] = []
    const end = Math.min(source.total - 1, range.endIndex)
    for (let index = Math.max(0, range.startIndex); index <= end && paths.length < 64; index += 1) {
      const entry = directoryEntryAt(source, index)
      if (entry?.kind === "directory") paths.push(entry.path)
    }
    const signature = `${source.sessionId}:${source.generation}:${paths.join("\u0000")}`
    if (signature === descriptionSignatureRef.current) return
    descriptionSignatureRef.current = signature
    descriptionRequestRef.current?.abort()
    if (!paths.length) {
      setDescriptions(new Map())
      return
    }
    const controller = new AbortController()
    descriptionRequestRef.current = controller
    void client.describeFolderPenetration(source.sessionId, paths, controller.signal).then(({ entries }) => {
      if (controller.signal.aborted || descriptionSignatureRef.current !== signature) return
      setDescriptions(new Map(entries.map((entry) => [entry.path, entry.internalFiles])))
    }).catch((cause) => {
      if (!controller.signal.aborted) reportError(`读取内部文件失败：${folderErrorMessage(cause)}`)
    })
  }

  return {
    penetration,
    descriptions,
    updatePenetration,
    requestDescriptions,
  }
}
