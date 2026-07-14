import type { NodeHelp } from "@xiranite/contract"

export const help = {
  title: "VERT",
  short: "Convert images, audio, video, and documents locally.",
  description: "Uses native ffmpeg, ImageMagick, and Pandoc commands first for performance, while the workspace GUI retains VERT-style WebAssembly conversion as a fallback.",
  whenToUse: ["Use VERT for general-purpose local format conversion across image, media, and document formats."],
  workflows: [
    { title: "Workspace GUI", summary: "Choose files and a target format from the VERT-inspired conversion surface.", ui: ["Drop or choose local files.", "Keep Auto selected to prefer native CLI tools and fall back to Wasm when unavailable.", "Review the plan, then convert and inspect each output."] },
    { title: "CLI / TUI", summary: "Plan or execute batch conversions from a terminal.", cli: ["Run `xiranite vert ui` for the full TUI.", "Run `xiranite vert plan input.png --to webp` before `xiranite vert convert input.png --to webp`."] },
  ],
  commands: [{ title: "Convert", command: "xiranite vert convert <files> --to <format>", description: "Convert with native commands.", examples: [{ label: "Image", command: "xiranite vert convert photo.png --to webp", description: "Uses ImageMagick when available." }, { label: "TUI", command: "xiranite vert ui", description: "Open the VERT terminal workbench." }] }],
  safety: { defaultMode: "preview", notes: ["Planning is the default terminal action.", "Existing files are preserved unless overwrite is explicitly enabled."] },
  translations: { "zh-CN": { title: "VERT", short: "在本机转换图像、音频、视频和文档。", description: "优先调用本机 ffmpeg、ImageMagick 与 Pandoc 以获得更高性能；工作区 GUI 同时保留 VERT 风格的 WebAssembly 回退转换。", whenToUse: ["需要通用的本地格式转换时使用 VERT。"], workflows: [{ title: "工作区 GUI", summary: "在 VERT 风格界面中选择文件与目标格式。", ui: ["拖入或选择本地文件。", "保持“自动”即可优先使用 CLI，缺失时回退 Wasm。", "先查看计划，再执行并检查输出。"] }, { title: "CLI / TUI", summary: "从终端预演或批量转换。", cli: ["运行 `xiranite vert ui` 打开完整 TUI。", "先运行 `xiranite vert plan input.png --to webp`，再执行 convert。"] }], commands: [{ title: "转换", command: "xiranite vert convert <files> --to <format>", description: "通过本机命令转换。", examples: [{ label: "图像", command: "xiranite vert convert photo.png --to webp", description: "优先使用 ImageMagick。" }, { label: "TUI", command: "xiranite vert ui", description: "打开 VERT 终端工作台。" }] }], safety: { defaultMode: "preview", notes: ["终端默认先预演。", "除非显式开启覆盖，否则保留同名文件。"] } } },
} satisfies NodeHelp
