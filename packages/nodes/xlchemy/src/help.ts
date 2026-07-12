import type { NodeHelp } from "@xiranite/contract"

export const help = {
  title: "Xlchemy",
  short: "Batch transcode images to JPEG XL, AVIF, WebP, PNG, TIFF, or JPEG.",
  description: "Xlchemy plans and runs high-performance image conversion with format-aware quality, effort, metadata, and output controls.",
  whenToUse: ["Convert image folders in batches.", "Compare lossless and lossy output plans.", "Preserve metadata while reducing storage size."],
  workflows: [{ title: "Workspace GUI", summary: "Configure and review a conversion batch.", ui: ["Add image files or folders.", "Choose format, quality, effort, and output policy.", "Preview the plan, then start conversion when the backend is connected."] }],
  commands: [
    {
      title: "Preview a conversion batch",
      command: "xiranite xlchemy plan D:/images --format jxl",
      description: "Show the planned outputs without writing image files.",
      examples: [
        {
          label: "Convert to AVIF",
          command: "xiranite xlchemy convert D:/images --format avif --quality 82",
          description: "Run a lossy AVIF conversion after reviewing the plan.",
        },
      ],
    },
  ],
  fields: [
    { name: "paths", type: "path[]", required: true, description: "Input image files or folders." },
    { name: "format", type: "enum", required: true, description: "Target image format." },
    { name: "lossless", type: "boolean", description: "Use lossless encoding where supported.", defaultValue: "false" },
    { name: "quality", type: "number", description: "Lossy quality from 1 to 100.", defaultValue: "60" },
    { name: "effort", type: "number", description: "Compression effort from 1 to 10.", defaultValue: "7" }
  ],
  safety: { defaultMode: "preview", notes: ["Plan mode does not write files.", "Overwrite remains disabled unless explicitly enabled."] },
  translations: { "zh-CN": { title: "Xlchemy", short: "批量转换 JPEG XL、AVIF、WebP、PNG、TIFF 或 JPEG。", description: "Xlchemy 提供格式感知的质量、压缩力度、元数据与输出策略，并支持预演后再执行。" } }
} satisfies NodeHelp
