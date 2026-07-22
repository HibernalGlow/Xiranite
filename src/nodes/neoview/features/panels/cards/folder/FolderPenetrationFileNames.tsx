import { Package } from "lucide-react"

import type { ReaderFolderViewMode } from "../../../../adapters/reader-http-client"

export interface FolderPenetrationFileName {
  name: string
  path: string
}

export function folderViewShowsPenetrationFiles(viewMode: ReaderFolderViewMode, enabled: boolean, showInternalFiles: boolean): boolean {
  return enabled && showInternalFiles && viewMode !== "details"
}

export function FolderPenetrationFileNames({ files, variant = "list" }: {
  files?: readonly FolderPenetrationFileName[]
  variant?: "list" | "overlay"
}) {
  if (!files?.length) return null
  return (
    <span
      className={variant === "overlay"
        ? "grid min-w-0 gap-0.5 rounded bg-black/65 px-1 py-0.5 text-white"
        : "grid min-w-0 gap-0.5 pt-0.5"}
      data-folder-penetration-files="true"
    >
      {files.map((file) => (
        <span key={file.path} className="flex min-w-0 items-start gap-1 border-t border-dashed border-current/20 first:border-0" title={file.path}>
          <Package className="mt-0.5 size-3 shrink-0 opacity-75" />
          <span className="break-all text-[10px] leading-tight">{file.name}</span>
        </span>
      ))}
    </span>
  )
}
