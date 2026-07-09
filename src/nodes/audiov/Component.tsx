import { createPackuToolComponent, PackuIcons } from "@/nodes/shared/MigratedToolPresets"

export const Component = createPackuToolComponent({
  id: "audiov",
  title: "AudioV",
  description: "从视频中提取音轨，保留 PackU AudioV 的 ffmpeg 调用边界。",
  icon: PackuIcons.audiov,
})
