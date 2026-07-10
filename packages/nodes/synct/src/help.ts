import type { NodeHelp } from "@xiranite/contract"

export const help = {
  title: "Synct",
  short: "Archive files or folders into date-based paths.",
  description: "Extract timestamps from file or folder names, build date-based destinations, move items natively, and optionally sync folder contents to the detected timestamp.",
  whenToUse: [
    "Use Synct when screenshots, downloads, or dated folders need to be grouped into year/month/day archive directories.",
  ],
  workflows: [
    {
      title: "File archive",
      summary: "Move files into date folders based on filename timestamps.",
      ui: ["Paste source folders.", "Select file mode and a date format.", "Preview target distribution before archive."],
    },
    {
      title: "Folder archive",
      summary: "Move dated folders and optionally sync internal file times.",
      ui: ["Select folder mode.", "Keep fallback enabled when names do not contain dates.", "Confirm live archive only after conflict review."],
    },
  ],
  commands: [
    {
      title: "Preview files",
      command: "xiranite synct plan D:/downloads --source-mode files --format nested_y_m",
      description: "Preview file archive destinations.",
      examples: [
        { label: "Archive folders", command: "xiranite synct archive D:/work --source-mode folders --archive-folder", description: "Move folders into a local archive directory." },
      ],
    },
  ],
  safety: {
    defaultMode: "dry-run",
    destructive: ["archive"],
    notes: ["Existing targets are reported as conflicts and skipped.", "Live archive is gated by confirmation in the UI."],
  },
  translations: {
    "zh-CN": {
      title: "Synct",
      short: "将文件或文件夹归档到按日期组织的路径。",
      description: "从文件或文件夹名中提取时间戳，构建按日期组织的目标路径，原生移动文件，并可选地将文件夹内容时间同步到检测到的时间戳。",
      whenToUse: [
        "当截图、下载文件或带日期的文件夹需要归入年/月/日归档目录时使用 Synct。",
      ],
      workflows: [
        {
          title: "文件归档",
          summary: "按文件名时间戳将文件移入日期文件夹。",
          ui: [
            "粘贴源文件夹。",
            "选择文件模式和日期格式。",
            "归档前预览目标分布。",
          ],
        },
        {
          title: "文件夹归档",
          summary: "移动带日期的文件夹，并可选同步内部文件时间。",
          ui: [
            "选择文件夹模式。",
            "名称不含日期时保持兜底选项开启。",
            "仅在冲突检查后再确认真实归档。",
          ],
        },
      ],
      commands: [
        {
          title: "预览文件",
          command: "xiranite synct plan D:/downloads --source-mode files --format nested_y_m",
          description: "预览文件归档目标。",
          examples: [
            { label: "归档文件夹", command: "xiranite synct archive D:/work --source-mode folders --archive-folder", description: "将文件夹移入本地归档目录。" },
          ],
        },
      ],
      safety: {
        defaultMode: "dry-run",
        destructive: ["archive"],
        notes: ["已存在的目标会作为冲突报告并跳过。", "真实归档在 UI 中需经确认才会执行。"],
      },
    },
  },
} satisfies NodeHelp
