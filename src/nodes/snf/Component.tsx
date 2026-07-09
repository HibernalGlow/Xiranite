import { createPackuToolComponent, PackuIcons } from "@/nodes/shared/MigratedToolPresets"

export const Component = createPackuToolComponent({
  id: "snf",
  title: "SNF",
  description: "修复编号目录顺序，让序列型资源保持连续和可追踪。",
  icon: PackuIcons.snf,
})
