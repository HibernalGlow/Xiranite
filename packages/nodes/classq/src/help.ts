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
} satisfies NodeHelp
