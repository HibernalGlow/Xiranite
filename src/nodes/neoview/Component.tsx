import { useEffect } from "react"
import type { NodeComponentProps } from "@xiranite/contract"

import { ReaderApp } from "./app/ReaderApp"
import { neoviewDebug, noteNeoviewMount, noteNeoviewUnmount } from "./neoviewDebug"

export interface NeoViewCardState extends Record<string, unknown> {
  path?: string
  browserOriginPath?: string | null
}

export function Component({ compId, host }: NodeComponentProps<NeoViewCardState>) {
  "use no memo"
  neoviewDebug("component:render:begin", { compId })
  const initialPath = host.state.getData()?.path
  const initialBrowserOriginPath = host.state.getData()?.browserOriginPath ?? undefined
  neoviewDebug("component:render:props", {
    compId,
    path: initialPath || undefined,
    hasBrowserOriginPath: Boolean(initialBrowserOriginPath),
  })

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
  }, [compId, initialPath])

  neoviewDebug("component:render:reader-app", { compId })
  return (
    <ReaderApp
      sessionScopeId={compId}
      initialPath={initialPath}
      initialBrowserOriginPath={initialBrowserOriginPath}
      pickFile={host.localFiles?.pickFiles
        ? async () => (await host.localFiles!.pickFiles!({
          title: "打开漫画或图片",
          filters: [{ displayName: "漫画与图片", pattern: "*.cbz;*.zip;*.jpg;*.jpeg;*.png;*.gif;*.webp;*.avif;*.jxl;*.tif;*.tiff" }],
        }))[0]
        : undefined}
      pickDirectory={host.localFiles?.pickDirectory}
      copyText={host.clipboard?.writeText}
      copyFiles={host.clipboard?.writeFiles}
      onPathCommitted={(path, browserOriginPath) => host.state.patchData({ path, browserOriginPath: browserOriginPath ?? null })}
    />
  )
}
