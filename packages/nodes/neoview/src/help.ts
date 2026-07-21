import type { NodeHelp } from "@xiranite/contract"

export const help = {
  title: "NeoView",
  short: "Browse NeoView reading history and bookmark metadata.",
  description: "Use the command line for lightweight library inspection and the GUI for opening books and images.",
  whenToUse: [
    "Use NeoView CLI to inspect recent reading history, bookmarks, bookmark lists, or library counts.",
    "Use the NeoView GUI when you need to open or view an image, comic, archive, or video.",
  ],
  workflows: [
    {
      title: "Library metadata",
      summary: "Read NeoView library metadata without starting the GUI.",
      cli: [
        "Run `xiranite neoview history --limit 50` to view recent reading history.",
        "Run `xiranite neoview bookmarks --list reading --json` to inspect one bookmark list.",
        "Run `xiranite neoview bookmark-lists` to list bookmark groups.",
        "Run `xiranite neoview stats --json` to inspect aggregate library counts.",
      ],
    },
  ],
  commands: [
    {
      title: "View reading history",
      command: "xiranite neoview history --limit 50",
      description: "Print a bounded page of recent reading records.",
      examples: [
        {
          label: "JSON history",
          command: "xiranite neoview history --filter archive --json",
          description: "Return archive history as JSON.",
        },
      ],
    },
    {
      title: "View bookmarks",
      command: "xiranite neoview bookmarks --json",
      description: "Print saved bookmark metadata without opening the referenced files.",
      examples: [
        {
          label: "One bookmark list",
          command: "xiranite neoview bookmarks --list reading --json",
          description: "Return one bookmark group as JSON.",
        },
      ],
    },
    {
      title: "View library statistics",
      command: "xiranite neoview stats",
      description: "Print aggregate history, bookmark, bookmark-list, and playlist counts.",
      examples: [],
    },
  ],
  safety: {
    defaultMode: "read-only",
    notes: [
      "The CLI does not expose image rendering, extraction, migration, maintenance, or file mutation commands.",
      "Use --database only when intentionally inspecting a non-default compatible NeoView database.",
    ],
  },
} satisfies NodeHelp
