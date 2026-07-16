import type { NodeComponentProps } from "@xiranite/contract"

import { ReaderApp } from "./app/ReaderApp"

export interface NeoViewCardState extends Record<string, unknown> {
  path?: string
}

export function Component({ host }: NodeComponentProps<NeoViewCardState>) {
  "use no memo"
  const initialPath = host.state.getData()?.path
  return (
    <ReaderApp
      initialPath={initialPath}
      pickFile={host.localFiles?.pickFiles
        ? async () => (await host.localFiles!.pickFiles!({
          title: "打开漫画或图片",
          filters: [{ displayName: "漫画与图片", pattern: "*.cbz;*.zip;*.jpg;*.jpeg;*.png;*.gif;*.webp;*.avif;*.jxl;*.tif;*.tiff" }],
        }))[0]
        : undefined}
      pickDirectory={host.localFiles?.pickDirectory}
      copyText={host.clipboard?.writeText}
      onPathCommitted={(path) => host.state.patchData({ path })}
    />
  )
}
