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
} satisfies NodeHelp
