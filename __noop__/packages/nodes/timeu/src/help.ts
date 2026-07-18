import type { NodeHelp } from "@xiranite/contract"

export const help = {
  title: "TimeU",
  short: "Back up and restore file timestamps from JSON records.",
  description: "Scan file timestamps, write JSON backup records, and restore atime/mtime later without a Python adapter.",
  whenToUse: [
    "Use TimeU before archive moves, renames, or recovery jobs when file modified/accessed times must be preserved.",
  ],
  workflows: [
    {
      title: "Backup",
      summary: "Record timestamps before a batch operation.",
      ui: [
        "Paste file or folder paths.",
        "Preview timestamp records.",
        "Run backup with dry-run off to write the JSON record file.",
      ],
    },
    {
      title: "Restore",
      summary: "Apply stored atime/mtime values back to existing files.",
      cli: [
        "Run `xiranite timeu restore D:/folder --record D:/folder/timeu-timestamps.json`.",
        "Run with `--dry-run` first to preview missing paths and changed timestamps.",
      ],
    },
  ],
  commands: [
    {
      title: "Backup timestamps",
      command: "xiranite timeu backup D:/archive --record D:/archive/timeu-timestamps.json",
      description: "Write a JSON timestamp record for files under a folder.",
      examples: [
        {
          label: "Restore timestamps",
          command: "xiranite timeu restore D:/archive --record D:/archive/timeu-timestamps.json",
          description: "Restore stored access and modified times.",
        },
      ],
    },
  ],
  safety: {
    defaultMode: "preview",
    notes: [
      "Dry-run is enabled by default.",
      "Birth and change times are recorded for reference; the native runtime restores access and modified times.",
      "Missing paths are reported and skipped.",
    ],
  },
  translations: {
    "zh-CN": {
      title: "TimeU",
      short: "从 JSON 记录备份和恢复文件时间戳。",
      description: "扫描文件时间戳，写入 JSON 备份记录，之后无需 Python 适配器即可恢复 atime/mtime。",
      whenToUse: [
        "在归档移动、重命名或恢复任务前，需要保留文件的修改/访问时间时使用 TimeU。",
      ],
      workflows: [
        {
          title: "备份",
          summary: "在批量操作前记录时间戳。",
          ui: [
            "粘贴文件或文件夹路径。",
            "预览时间戳记录。",
            "关闭试运行后运行备份，写入 JSON 记录文件。",
          ],
        },
        {
          title: "恢复",
          summary: "将存储的 atime/mtime 值写回现有文件。",
          cli: [
            "运行 `xiranite timeu restore D:/folder --record D:/folder/timeu-timestamps.json`。",
            "先加 `--dry-run` 预览缺失路径和已变更的时间戳。",
          ],
        },
      ],
      commands: [
        {
          title: "备份时间戳",
          command: "xiranite timeu backup D:/archive --record D:/archive/timeu-timestamps.json",
          description: "为文件夹下的文件写入 JSON 时间戳记录。",
          examples: [
            {
              label: "恢复时间戳",
              command: "xiranite timeu restore D:/archive --record D:/archive/timeu-timestamps.json",
              description: "恢复已存储的访问和修改时间。",
            },
          ],
        },
      ],
      safety: {
        defaultMode: "preview",
        notes: [
          "默认开启试运行。",
          "创建和变更时间仅作为参考记录；原生运行时只恢复访问和修改时间。",
          "缺失路径会被报告并跳过。",
        ],
      },
    },
  },
} satisfies NodeHelp
