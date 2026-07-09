import type { NodeHelp } from "@xiranite/contract"

export const help = {
  title: "SNF",
  short: "Repair numbered folder sequences inside artist folders.",
  description: "Scan numbered subfolders, detect sequence gaps, reorder by priority keywords, and apply safe native renames.",
  whenToUse: [
    "Use SNF when artist folders contain numbered categories such as 1. CG, 3. Commercial and the sequence needs to be continuous.",
  ],
  workflows: [
    {
      title: "Preview sequence repair",
      summary: "Build a renumbering plan without changing folders.",
      ui: [
        "Paste a library root or artist folder.",
        "Choose whether paths are library roots or direct artist folders.",
        "Review conflicts before running live rename.",
      ],
    },
  ],
  commands: [
    {
      title: "Preview library",
      command: "xiranite snf plan D:/archives --mode library",
      description: "Preview sequence repairs for every artist folder under a library root.",
      examples: [
        { label: "Single artist", command: "xiranite snf plan D:/archives/Artist --mode artist", description: "Preview one artist folder." },
        { label: "Apply rename", command: "xiranite snf rename D:/archives --mode library", description: "Apply live sequence repairs." },
      ],
    },
  ],
  safety: {
    defaultMode: "dry-run",
    destructive: ["rename"],
    notes: ["Conflicting target folder names are reported and skipped.", "Live rename keeps folder timestamps by default."],
  },
} satisfies NodeHelp
