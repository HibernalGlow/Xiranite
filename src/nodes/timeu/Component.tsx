import { createPackuToolComponent, PackuIcons } from "@/nodes/shared/MigratedToolPresets"

export const Component = createPackuToolComponent({
  id: "timeu",
  title: "TimeU",
  description: "备份或恢复文件时间戳，适合归档整理前后的时间记录。",
  icon: PackuIcons.timeu,
})
