import { createPackuToolComponent, PackuIcons } from "@/nodes/shared/MigratedToolPresets"

export const Component = createPackuToolComponent({
  id: "coveru",
  title: "CoverU",
  description: "从归档中提取封面并按 CoverU 配置转换输出。",
  icon: PackuIcons.coveru,
})
