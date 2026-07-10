import type { NodeHelp } from "@xiranite/contract"

export const help = {
  title: "ClassQ",
  short: "Find keyword folders and move sibling items into wait folders.",
  description: "Recursively scans root directories for folders containing a keyword such as already, then plans same-level sibling files and folders into a wait folder.",
  whenToUse: [
    "Use ClassQ when reviewed folders are marked by name and everything beside them should be queued into a wait folder.",
  ],
  workflows: [
    {
      title: "Keyword scan",
      summary: "Scan roots, find keyword folders, and preview wait-folder transfers.",
      ui: ["Paste one or more root directories.", "Set keyword and wait folder name.", "Review grouped wait transfers before live classify."],
    },
    {
      title: "Live classify",
      summary: "Move or copy ready siblings into the planned wait folders.",
      ui: ["Run a plan first.", "Choose move or copy.", "Disable dry run and confirm live classify."],
    },
  ],
  commands: [
    {
      title: "Preview keyword classification",
      command: "xiranite classq plan D:/set --keyword already --wait wait",
      description: "Preview wait transfers under roots containing already folders.",
      examples: [
        { label: "Copy wait candidates", command: "xiranite classq classify D:/set --keyword done --wait wait --transfer copy", description: "Copy wait candidates instead of moving them." },
      ],
    },
  ],
  safety: {
    defaultMode: "dry-run",
    destructive: ["classify"],
    notes: ["Live move/copy is gated by confirmation in the UI.", "Existing targets are reported as conflicts and skipped."],
  },
  translations: {
    "zh-CN": {
      title: "ClassQ",
      short: "查找关键词文件夹并将同级项移入 wait 文件夹。",
      description: "递归扫描根目录，查找包含 already 等关键词的文件夹，然后将同级的文件与文件夹规划到 wait 文件夹中。",
      whenToUse: [
        "当已审阅的文件夹通过名称标记，且其旁的其余项需要排入 wait 文件夹时使用 ClassQ。",
      ],
      workflows: [
        {
          title: "关键词扫描",
          summary: "扫描根目录、查找关键词文件夹，并预览 wait 文件夹的转移。",
          ui: ["粘贴一个或多个根目录。", "设置关键词和 wait 文件夹名称。", "在真实分类前查看分组的 wait 转移。"],
        },
        {
          title: "真实分类",
          summary: "将就绪的同级项移动或复制到已规划的 wait 文件夹。",
          ui: ["先运行一次计划。", "选择 move 或 copy。", "关闭 dry run 并确认真实分类。"],
        },
      ],
      commands: [
        {
          title: "预览关键词分类",
          command: "xiranite classq plan D:/set --keyword already --wait wait",
          description: "预览包含 already 文件夹的根目录下的 wait 转移。",
          examples: [
            { label: "复制 wait 候选项", command: "xiranite classq classify D:/set --keyword done --wait wait --transfer copy", description: "以复制代替移动来处理 wait 候选项。" },
          ],
        },
      ],
      safety: {
        defaultMode: "dry-run",
        destructive: ["classify"],
        notes: ["UI 中的真实移动/复制需要二次确认。", "已存在的目标会被作为冲突报告并跳过。"],
      },
    },
  },
} satisfies NodeHelp
