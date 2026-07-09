import { createPackuToolComponent, PackuIcons } from "@/nodes/shared/MigratedToolPresets"

export const Component = createPackuToolComponent({
  id: "bitv",
  title: "BitV",
  description: "分析视频码率并输出分类报告，作为视频整理前的检查节点。",
  icon: PackuIcons.bitv,
})
