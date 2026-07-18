import type { NodeHelp } from "@xiranite/contract"

export const help = {
  title: "CoverU",
  short: "Extract cover images from archives and image folders.",
  description: "Plan and extract cover files from ZIP/CBZ archives or loose image inputs without a Python adapter.",
  whenToUse: [
    "Use CoverU when archive cover files need to be detected, reviewed, and extracted into a predictable output location.",
  ],
  workflows: [
    {
      title: "Workspace UI",
      summary: "Paste archive or folder paths, review the cover contact sheet, then extract selected cover candidates.",
      ui: [
        "Paste ZIP/CBZ archives, loose image files, or folders that contain them.",
        "Run scan or plan to inspect cover candidates and unsupported archives.",
        "Switch from preview to extract only after the output directory and overwrite policy are correct.",
      ],
    },
    {
      title: "CLI",
      summary: "Run CoverU directly from a terminal.",
      cli: [
        "Run `xiranite coveru plan <path>` to inspect cover candidates.",
        "Run `xiranite coveru extract <path> --output-dir <dir>` to write cover files.",
      ],
    },
  ],
  commands: [
    {
      title: "Plan cover extraction",
      command: "xiranite coveru plan D:/archives",
      description: "Inspect archives and print a summary without writing files.",
      examples: [
        {
          label: "Extract to a directory",
          command: "xiranite coveru extract D:/archives --output-dir D:/covers",
          description: "Extract detected covers into one output folder.",
        },
        {
          label: "Allow overwrite",
          command: "xiranite coveru extract D:/archives --output-dir D:/covers --overwrite",
          description: "Replace existing output files when names collide.",
        },
      ],
    },
  ],
  safety: {
    defaultMode: "preview",
    notes: [
      "Plan first when processing a large folder.",
      "Overwrite is disabled by default.",
      "Unsupported archive formats are reported instead of invoking external tools.",
    ],
  },
  translations: {
    "zh-CN": {
      title: "CoverU",
      short: "从归档和图片文件夹中提取封面图片。",
      description: "在无需 Python 适配器的情况下，规划并从 ZIP/CBZ 归档或散图输入中提取封面文件。",
      whenToUse: [
        "当归档封面需要被检测、审阅并提取到一个可预测的输出位置时使用 CoverU。",
      ],
      workflows: [
        {
          title: "工作区 UI",
          summary: "粘贴归档或文件夹路径，查看封面联系表，再提取选中的封面候选项。",
          ui: [
            "粘贴 ZIP/CBZ 归档、散图文件或包含它们的文件夹。",
            "运行扫描或计划，查看封面候选项与不支持的归档。",
            "在输出目录与覆盖策略正确无误后，再从预览切换到提取。",
          ],
        },
        {
          title: "CLI",
          summary: "直接在终端运行 CoverU。",
          cli: [
            "运行 `xiranite coveru plan <path>` 查看封面候选项。",
            "运行 `xiranite coveru extract <path> --output-dir <dir>` 写入封面文件。",
          ],
        },
      ],
      commands: [
        {
          title: "规划封面提取",
          command: "xiranite coveru plan D:/archives",
          description: "检查归档并打印摘要，不写入文件。",
          examples: [
            {
              label: "提取到目录",
              command: "xiranite coveru extract D:/archives --output-dir D:/covers",
              description: "将检测到的封面提取到一个输出文件夹中。",
            },
            {
              label: "允许覆盖",
              command: "xiranite coveru extract D:/archives --output-dir D:/covers --overwrite",
              description: "当文件名冲突时替换已有的输出文件。",
            },
          ],
        },
      ],
      safety: {
        defaultMode: "preview",
        notes: [
          "处理大型文件夹时先运行计划。",
          "覆盖默认是关闭的。",
          "不支持的归档格式会被报告，而不是调用外部工具。",
        ],
      },
    },
  },
} satisfies NodeHelp
