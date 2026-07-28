import type { NodeHelp } from "@xiranite/contract"

export const help = {
  title: "ClassF",
  short: "Classify detected files into already, del, or wait without losing path context.",
  description: "ClassF detects files recursively, matches artist metadata through SameA and CrashU, then transfers each file to already, del, or wait either beside its current directory or below one target root while preserving the complete relative path. Existing CrashU matches always stay in already before a blacklist is considered.",
  whenToUse: [
    "Use ClassF when nested archive trees must be classified without flattening their existing directory structure.",
  ],
  workflows: [
    {
      title: "Pipeline classify",
      summary: "Detect every file recursively and classify it below its own current directory.",
      ui: ["Copy SameA archive roots to the clipboard.", "Run the default pipeline preview.", "Review the pipeline result before live classify."],
    },
    {
      title: "Target-root classify",
      summary: "Create already and wait below one target root while preserving every source-relative directory.",
      ui: ["Select root placement.", "Set the target root.", "Choose move or copy, then review the complete tree first."],
    },
  ],
  commands: [
    {
      title: "Preview auto classify",
      command: "xiranite classf plan D:/set --classify auto --placement local",
      description: "Preview selected and wait transfers.",
      examples: [
        { label: "Copy to target root", command: "xiranite classf classify D:/set --classify auto --placement root --target D:/done --transfer copy", description: "Copy files below target-root already/wait while preserving relative paths." },
        { label: "Add a blacklist keyword", command: "xiranite classf plan D:/set --blacklist-keyword \"[Circle (Artist)]\"", description: "SameA artist labels matching a keyword move to del unless CrashU already matches them." },
        { label: "Choose independent queues", command: "xiranite classf plan D:/set --no-already --wait --del --samea-group-wait", description: "Queue and SameA grouping flags can be enabled independently; --classify remains available for legacy scripts." },
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
      short: "递归检测所有文件，并在不丢失路径分类的前提下分流到 already、del 或 wait。",
      description: "ClassF 使用 SameA 与 CrashU 判断文件归类，再由 MigrateF 逐文件转移。既可以在文件当前目录创建 already/del/wait，也可以在给定根目录下分流并完整保留相对路径。CrashU 已匹配的项目始终优先进入 already，之后才判断黑名单。",
      whenToUse: [
        "当多层文件夹需要递归分类，但不能打散或抹掉原有路径层级时使用 ClassF。",
      ],
      workflows: [
        {
          title: "自动分类",
          summary: "递归检测文件，并在每个文件当前所在目录下创建 already 或 wait。",
          ui: ["粘贴来源根目录。", "选择“文件所在目录”。", "在真实分类前检查完整文件树。"],
        },
        {
          title: "根目录分流",
          summary: "在给定根目录下创建 already/wait，并保留来源根目录以下的完整相对路径。",
          ui: ["选择“给定根目录”。", "填写目标根目录。", "选择移动或复制，然后先检查计划。"],
        },
      ],
      commands: [
        {
          title: "预览自动分类",
          command: "xiranite classf plan D:/set --classify auto --placement local",
          description: "预览每个文件所在目录下的 already/wait 分流。",
          examples: [
            { label: "复制到目标根目录", command: "xiranite classf classify D:/set --classify auto --placement root --target D:/done --transfer copy", description: "保留相对路径并复制到目标根目录下的 already/wait。" },
            { label: "添加黑名单关键词", command: "xiranite classf plan D:/set --blacklist-keyword \"[社团 (作者)]\"", description: "SameA 标签命中关键词时进入 del；CrashU 已匹配的项目仍优先进入 already。" },
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
