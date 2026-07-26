import { Trash2 } from "lucide-react"

import type { ContextMenuItemDef } from "@/components/context-menu/ContextMenuProvider"

export function readerCurrentFileDeleteConfirmation(sourcePath: string): ContextMenuItemDef {
  const name = sourcePath.replaceAll("\\", "/").split("/").at(-1) ?? sourcePath
  return {
    id: "neoview-reader-delete-current-file",
    label: "删除当前文件",
    icon: <Trash2 />,
    destructive: true,
    confirm: {
      title: "移到回收站？",
      description: `“${name}”将移到系统回收站。`,
      confirmLabel: "移到回收站",
      cancelLabel: "取消",
    },
  }
}
