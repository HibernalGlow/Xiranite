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
} satisfies NodeHelp
