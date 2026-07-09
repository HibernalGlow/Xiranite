import { createPackuToolComponent, PackuIcons } from "@/nodes/shared/MigratedToolPresets"

export const Component = createPackuToolComponent({
  id: "synct",
  title: "Synct",
  description: "按提取时间戳归档文件或目录，适合时间线整理。",
  icon: PackuIcons.synct,
})
