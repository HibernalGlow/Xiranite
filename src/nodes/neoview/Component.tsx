import type { NodeComponentProps } from "@xiranite/contract"

import { ReaderApp } from "./app/ReaderApp"

export interface NeoViewCardState extends Record<string, unknown> {
  path?: string
  browserOriginPath?: string | null
}

export function Component({ host }: NodeComponentProps<NeoViewCardState>) {
  "use no memo"
  const initialPath = host.state.getData()?.path
  const initialBrowserOriginPath = host.state.getData()?.browserOriginPath ?? undefined
  return (
    <ReaderApp
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
