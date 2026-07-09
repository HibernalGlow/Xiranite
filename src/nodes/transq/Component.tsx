import { createPackuToolComponent, PackuIcons } from "@/nodes/shared/MigratedToolPresets"

export const Component = createPackuToolComponent({
  id: "transq",
  title: "TransQ",
  description: "整理翻译结果文件，维护翻译队列和输出位置。",
  icon: PackuIcons.transq,
})
