import type { NodeHelp } from "@xiranite/contract"

export const help = {
  title: "ClassF",
  short: "Classify selected paths into already, wait, or a target folder.",
  description: "Plan and apply native move/copy transfers for selected files and folders. Auto mode sends selected items to already and remaining siblings to wait.",
  whenToUse: [
    "Use ClassF when a folder has reviewed items and remaining items that need to be split into already and wait queues.",
  ],
  workflows: [
    {
      title: "Auto classify",
      summary: "Move selected items to already and other siblings to wait.",
      ui: ["Paste selected source paths.", "Keep classify mode on auto.", "Preview the already/wait split before live classify."],
    },
    {
      title: "Direct target",
      summary: "Move or copy selected paths into one explicit target folder.",
      ui: ["Switch classify mode to off.", "Set a target folder.", "Choose move or copy, then run a plan first."],
    },
  ],
  commands: [
    {
      title: "Preview auto classify",
      command: "xiranite classf plan D:/set/a.zip --classify auto",
      description: "Preview selected and wait transfers.",
      examples: [
        { label: "Copy to target", command: "xiranite classf classify D:/set/a.zip --classify off --target D:/done --transfer copy", description: "Copy selected paths to an explicit folder." },
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
      title: "ClassF",
      short: "将选中路径分类到 already、wait 或目标文件夹。",
      description: "规划并应用原生的移动/复制操作。自动模式会将选中项送入 already，将其余同级项送入 wait。",
      whenToUse: [
        "当文件夹中包含已审阅项与待处理项，需要拆分到 already 与 wait 队列时使用 ClassF。",
      ],
      workflows: [
        {
          title: "自动分类",
          summary: "将选中项移入 already，其余同级项移入 wait。",
          ui: ["粘贴选中的源路径。", "保持 classify 模式为 auto。", "在真实分类前预览 already/wait 拆分结果。"],
        },
        {
          title: "直接目标",
          summary: "将选中路径移动或复制到一个明确的目标文件夹。",
          ui: ["将 classify 模式切换为 off。", "设置一个目标文件夹。", "选择 move 或 copy，然后先运行一次计划。"],
        },
      ],
      commands: [
        {
          title: "预览自动分类",
          command: "xiranite classf plan D:/set/a.zip --classify auto",
          description: "预览选中项与 wait 项的转移。",
          examples: [
            { label: "复制到目标", command: "xiranite classf classify D:/set/a.zip --classify off --target D:/done --transfer copy", description: "将选中路径复制到指定文件夹。" },
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
