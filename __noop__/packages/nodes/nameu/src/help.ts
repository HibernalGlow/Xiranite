import type { NodeHelp } from "@xiranite/contract"

export const help = {
  title: "NameU",
  short: "Preview and apply archive filename cleanup for artist folders.",
  description: "Scan artist archive folders, normalize archive and folder names, append artist names when needed, and apply the rename plan natively.",
  whenToUse: [
    "Use NameU when archive filenames need consistent brackets, spacing, event tags, and artist suffixes before long-term storage.",
  ],
  workflows: [
    {
      title: "Preview",
      summary: "Build a rename plan without changing files.",
      ui: [
        "Paste one library root or one artist folder.",
        "Choose multi-folder or single-folder mode.",
        "Review ready, unchanged, skipped, and conflict rows before applying.",
      ],
    },
    {
      title: "Apply",
      summary: "Run the same plan as a native filesystem rename.",
      ui: [
        "Keep dry-run on until the plan looks correct.",
        "Turn dry-run off and confirm the rename action.",
        "Check conflicts and errors after execution.",
      ],
    },
  ],
  commands: [
    {
      title: "Preview library",
      command: "xiranite nameu plan D:/archives --mode multi",
      description: "Preview all artist folders under a library root.",
      examples: [
        {
          label: "Single artist folder",
          command: "xiranite nameu plan D:/archives/Artist --mode single",
          description: "Preview one artist folder.",
        },
        {
          label: "Apply rename",
          command: "xiranite nameu rename D:/archives --mode multi --no-artist",
          description: "Apply a live rename plan without appending artist names.",
        },
      ],
    },
  ],
  fields: [
    { name: "paths", type: "string[]", required: true, description: "Library roots or artist folders to scan." },
    { name: "mode", type: "multi | single", description: "Whether paths are library roots or direct artist folders.", defaultValue: "multi" },
    { name: "dryRun", type: "boolean", description: "Preview without writing changes.", defaultValue: "true" },
    { name: "addArtistName", type: "boolean", description: "Append the artist folder name when it is missing.", defaultValue: "true" },
  ],
  safety: {
    defaultMode: "dry-run",
    destructive: ["rename"],
    notes: [
      "Live rename is gated by confirmation in the UI.",
      "Conflicting target names are reported and not renamed.",
      "Archive ID database/comment support from the Python tool is not invoked by this native node.",
    ],
  },
  translations: {
    "zh-CN": {
      title: "NameU",
      short: "为画师文件夹预览并执行归档文件名清理。",
      description: "扫描画师归档文件夹，规范化归档与文件夹名称，按需追加画师名，并以原生方式执行重命名计划。",
      whenToUse: [
        "归档文件名在长期保存前需要统一括号、空格、活动标签和画师后缀时，使用 NameU。",
      ],
      workflows: [
        {
          title: "预览",
          summary: "生成重命名计划，不修改文件。",
          ui: [
            "粘贴一个库根目录或一个画师文件夹。",
            "选择多文件夹或单文件夹模式。",
            "应用前查看 ready、unchanged、skipped 和 conflict 各行。",
          ],
        },
        {
          title: "应用",
          summary: "将同一计划作为原生文件系统重命名执行。",
          ui: [
            "计划确认无误前保持 dry-run 开启。",
            "关闭 dry-run 并确认重命名动作。",
            "执行后检查冲突与错误。",
          ],
        },
      ],
      commands: [
        {
          title: "预览库",
          command: "xiranite nameu plan D:/archives --mode multi",
          description: "预览库根目录下的所有画师文件夹。",
          examples: [
            {
              label: "单个画师文件夹",
              command: "xiranite nameu plan D:/archives/Artist --mode single",
              description: "预览单个画师文件夹。",
            },
            {
              label: "应用重命名",
              command: "xiranite nameu rename D:/archives --mode multi --no-artist",
              description: "执行真实重命名计划，且不追加画师名。",
            },
          ],
        },
      ],
      fields: [
        { name: "paths", type: "string[]", required: true, description: "要扫描的库根目录或画师文件夹。" },
        { name: "mode", type: "multi | single", description: "指定 paths 是库根目录还是直接的画师文件夹。", defaultValue: "multi" },
        { name: "dryRun", type: "boolean", description: "仅预览，不写入变更。", defaultValue: "true" },
        { name: "addArtistName", type: "boolean", description: "缺失时追加画师文件夹名。", defaultValue: "true" },
      ],
      safety: {
        defaultMode: "dry-run",
        destructive: ["rename"],
        notes: [
          "UI 中的真实重命名需要二次确认。",
          "冲突的目标名会被上报，不执行重命名。",
          "该原生节点不会调用 Python 工具的归档 ID 数据库/评论支持。",
        ],
      },
    },
  },
} satisfies NodeHelp
