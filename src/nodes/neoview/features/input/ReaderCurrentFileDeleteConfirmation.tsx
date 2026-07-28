import { Trash2 } from "lucide-react"

import type { ContextMenuItemDef } from "@/components/context-menu/ContextMenuProvider"

export function readerCurrentFileDeleteConfirmation(sourcePath: string, strategy: "trash" | "delete" = "trash"): ContextMenuItemDef {
  const name = sourcePath.replaceAll("\\", "/").split("/").at(-1) ?? sourcePath
  const permanent = strategy === "delete"
  return {
    id: "neoview-reader-delete-current-file",
    label: "删除当前文件",
    icon: <Trash2 />,
    destructive: true,
    confirm: {
      title: permanent ? "永久删除？" : "移到回收站？",
      description: permanent ? `“${name}”将被永久删除，无法从回收站恢复。` : `“${name}”将移到系统回收站。`,
      confirmLabel: permanent ? "永久删除" : "移到回收站",
      cancelLabel: "取消",
    },
  }
}
