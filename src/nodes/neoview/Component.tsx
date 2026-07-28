import { useEffect, useState } from "react"
import type { ExternalNodeLaunchRequest, NodeComponentProps } from "@xiranite/contract"

import { ReaderApp } from "./app/ReaderApp"
import { neoviewDebug, noteNeoviewMount, noteNeoviewUnmount } from "./neoviewDebug"

export interface NeoViewCardState extends Record<string, unknown> {
  path?: string
  browserOriginPath?: string | null
  activationRootPath?: string | null
  swimlaneSoloLaneId?: string | null
  readerViewFullscreen?: boolean
  keepAliveOnViewSwitch?: boolean
}

export function Component({ compId, host }: NodeComponentProps<NeoViewCardState>) {
  "use no memo"
  const initialState = host.state.getData()
  const initialPath = initialState?.path
  const initialBrowserOriginPath = initialState?.browserOriginPath ?? undefined
  const initialActivationRootPath = initialState?.activationRootPath ?? undefined
  const initialSwimlaneSoloLaneId = initialState?.swimlaneSoloLaneId
  const initialReaderViewFullscreen = initialState?.readerViewFullscreen
  const [externalLaunches, setExternalLaunches] = useState<Array<{ requestId: string; path: string; kind: "file" | "directory" }>>([])
  const externalLaunch = externalLaunches[0]

  // Track true instance lifetime only. Do NOT depend on initialPath: openPath
  // commits path into host state and would fake unmount/remount mid-read.
  useEffect(() => {
    noteNeoviewMount(compId, { path: initialPath })
    const mountedAt = performance.now()
    const raf = requestAnimationFrame(() => {
      neoviewDebug("component:first-frame", {
        compId,
        path: initialPath || undefined,
        sinceMountMs: Math.round((performance.now() - mountedAt) * 10) / 10,
      })
    })
    return () => {
      cancelAnimationFrame(raf)
      noteNeoviewUnmount(compId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount lifetime is compId-only
  }, [compId])

  useEffect(() => {
    const onExternalLaunch = (event: Event) => {
      const request = (event as CustomEvent<unknown>).detail
      if (!isNeoViewExternalLaunchRequest(request)) return
      try {
        const path = localPathFromExternalLaunchURI(request.targets[0]!.uri)
        setExternalLaunches((pending) => [...pending, { requestId: request.requestId, path, kind: request.targets[0]!.kind }])
      } catch (cause) {
        void acknowledgeExternalLaunch(request.requestId, false, errorMessage(cause))
      }
    }
    window.addEventListener("xiranite:external-node-launch", onExternalLaunch)
    return () => window.removeEventListener("xiranite:external-node-launch", onExternalLaunch)
  }, [host.state])

  useEffect(() => {
    if (!initialPath) return
    neoviewDebug("component:path-committed", { compId, path: initialPath })
  }, [compId, initialPath])

  return (
    <ReaderApp
      sessionScopeId={compId}
      initialPath={initialPath}
      initialBrowserOriginPath={initialBrowserOriginPath}
      initialActivationRootPath={initialActivationRootPath}
      externalOpenRequest={externalLaunch}
      onExternalOpenResult={(result) => {
        void acknowledgeExternalLaunch(result.requestId!, result.opened, result.message)
        setExternalLaunches((pending) => pending.filter((launch) => launch.requestId !== result.requestId))
      }}
      initialSwimlaneSoloLaneId={initialSwimlaneSoloLaneId}
      initialReaderViewFullscreen={initialReaderViewFullscreen}
      pickFile={host.localFiles?.pickFiles
        ? async () => (await host.localFiles!.pickFiles!({
          title: "打开漫画或图片",
          filters: [{ displayName: "漫画与图片", pattern: "*.cbz;*.zip;*.jpg;*.jpeg;*.png;*.gif;*.webp;*.avif;*.jxl;*.tif;*.tiff" }],
        }))[0]
        : undefined}
      pickDirectory={host.localFiles?.pickDirectory}
      pickEfuFile={host.localFiles?.pickFiles
        ? async () => (await host.localFiles!.pickFiles!({
          title: "导入 Everything 文件列表",
          filters: [{ displayName: "Everything 文件列表", pattern: "*.efu" }],
        }))[0]
        : undefined}
      copyText={host.clipboard?.writeText}
      copyFiles={host.clipboard?.writeFiles}
      onPathCommitted={(path, browserOriginPath, activationRootPath) => host.state.patchData({
        path,
        browserOriginPath: browserOriginPath ?? null,
        activationRootPath: activationRootPath ?? (path || null),
      })}
      onSwimlaneSoloLaneIdCommitted={(swimlaneSoloLaneId) => host.state.patchData({ swimlaneSoloLaneId })}
      onReaderViewFullscreenCommitted={(readerViewFullscreen) => host.state.patchData({ readerViewFullscreen })}
    />
  )
}

function isNeoViewExternalLaunchRequest(value: unknown): value is ExternalNodeLaunchRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const request = value as Partial<ExternalNodeLaunchRequest>
  return request.version === 1
    && request.nodeId === "neoview"
    && request.intent === "open"
    && Array.isArray(request.targets)
    && request.targets.length === 1
    && (request.targets[0]?.kind === "file" || request.targets[0]?.kind === "directory")
    && typeof request.targets[0]?.uri === "string"
}

function localPathFromExternalLaunchURI(uri: string): string {
  const target = new URL(uri)
  if (target.protocol !== "file:" || target.search || target.hash || target.username || target.password) {
    throw new Error("NeoView external launch accepts only local file: targets.")
  }
  const path = decodeURIComponent(target.pathname)
  if (!path) throw new Error("NeoView external launch target path is empty.")
  if (target.hostname && target.hostname !== "localhost") {
    return `\\\\${target.hostname}${path.replaceAll("/", "\\")}`
  }
  return /^\/[A-Za-z]:\//u.test(path) ? path.slice(1) : path
}

async function acknowledgeExternalLaunch(requestId: string, accepted: boolean, message?: string): Promise<void> {
  if (typeof window === "undefined" || !window._wails) return
  try {
    const runtime = await import("@wailsio/runtime")
    await runtime.Call.ByName("main.XiraniteService.AcknowledgeExternalNodeLaunch", { requestId, accepted, message })
  } catch {
    // Workspace and ordinary standalone hosts intentionally do not expose this method.
  }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
