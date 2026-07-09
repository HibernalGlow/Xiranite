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
} satisfies NodeHelp
