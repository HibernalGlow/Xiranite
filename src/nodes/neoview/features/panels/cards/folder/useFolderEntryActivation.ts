import { useCallback, useEffect, useRef, type RefObject } from "react"

import type { ReaderDirectoryEntryDto, ReaderFolderPenetrationConfig, ReaderHttpClient } from "../../../../adapters/reader-http-client"
import type { ReaderPanelContext } from "../../../registry"
import { folderErrorMessage, type DirectoryCatalog } from "./DirectoryCatalog"

const PENETRATION_CLICK_DELAY_MS = 180

type DirectoryActivationEntry = Pick<ReaderDirectoryEntryDto, "kind" | "name" | "path" | "readerSupported">

export function useFolderEntryActivation({
  client,
  catalogRef,
  penetration,
  switchToast,
  openReaderEntry,
  enterRawDirectory,
  toggleInlineBranch,
  reportError,
}: {
  client: ReaderHttpClient
  catalogRef: RefObject<DirectoryCatalog | undefined>
  penetration: ReaderFolderPenetrationConfig
  switchToast: ReaderPanelContext["switchToast"]
  openReaderEntry(entry: Pick<ReaderDirectoryEntryDto, "path">, browserOriginEntryPath?: string, browserOriginSelfTerminal?: boolean): void
  enterRawDirectory(entry: Pick<ReaderDirectoryEntryDto, "path">): void
  toggleInlineBranch(path: string): void
  reportError(message: string): void
}) {
  const pendingRef = useRef<{
    path: string
    sessionId: string
    generation: number
    controller: AbortController
    timer: ReturnType<typeof setTimeout>
  }>()

  const cancelPendingActivation = useCallback(() => {
    const pending = pendingRef.current
    if (!pending) return
    pendingRef.current = undefined
    clearTimeout(pending.timer)
    pending.controller.abort()
  }, [])

  useEffect(() => cancelPendingActivation, [cancelPendingActivation])

  const activate = useCallback((entry: DirectoryActivationEntry, rawDirectory = false) => {
    if (entry.kind !== "directory") {
      if (entry.readerSupported) openReaderEntry(entry)
      else void client.openSystemPath?.(entry.path)
      return
    }
    if (rawDirectory || !penetration.enabled || !client.resolveFolderPenetration) {
      enterRawDirectory(entry)
      return
    }
    const current = catalogRef.current
    if (!current) return
    cancelPendingActivation()
    const controller = new AbortController()
    const pending = {
      path: entry.path,
      sessionId: current.sessionId,
      generation: current.generation,
      controller,
      timer: setTimeout(() => undefined, PENETRATION_CLICK_DELAY_MS),
    }
    pendingRef.current = pending
    clearTimeout(pending.timer)
    const delay = new Promise<void>((resolve) => {
      pending.timer = setTimeout(resolve, PENETRATION_CLICK_DELAY_MS)
    })
    void Promise.all([
      client.resolveFolderPenetration(
        current.sessionId,
        entry.path,
        { maxDepth: penetration.maxDepth, terminalTargets: penetration.terminalTargets },
        controller.signal,
      ),
      delay,
    ])
      .then(([resolution]) => {
        if (pendingRef.current !== pending) return
        pendingRef.current = undefined
        if (catalogRef.current?.sessionId !== pending.sessionId || catalogRef.current?.generation !== pending.generation) return
        if (resolution.status === "resolved" && resolution.terminal) {
          const mixedMedia = resolution.reason === "mixed-media-directory"
          if (mixedMedia) {
            switchToast?.show({
              title: `先阅读“${entry.name}”的当前层图片`,
              description: `当前层 ${resolution.directMediaCount ?? 0} 张图片；发现 ${resolution.deferredDirectoryCount ?? 0} 个子文件夹，可继续作为“下一本”。`,
            })
          }
          openReaderEntry({ path: resolution.terminal.path }, entry.path, mixedMedia)
          return
        }
        if (resolution.status === "branch" && penetration.expandBranchesInline && (resolution.directDirectoryCount ?? 0) >= 2) {
          toggleInlineBranch(entry.path)
          return
        }
        if (resolution.status === "blocked" && (resolution.reason === "permission" || resolution.reason === "cycle")) {
          reportError(`无法穿透此文件夹：${resolution.reason === "permission" ? "没有读取权限" : "检测到目录循环"}`)
          return
        }
        enterRawDirectory(entry)
      })
      .catch((cause) => {
        if (controller.signal.aborted || pendingRef.current !== pending) return
        pendingRef.current = undefined
        reportError(`穿透解析失败：${folderErrorMessage(cause)}`)
      })
  }, [cancelPendingActivation, catalogRef, client, enterRawDirectory, openReaderEntry, penetration, reportError, switchToast, toggleInlineBranch])

  return { activate, cancelPendingActivation }
}
