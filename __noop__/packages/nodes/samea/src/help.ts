import type { NodeHelp } from "@xiranite/contract"

export const help = {
  title: "SameA",
  short: "Extract artist metadata from archive names and organize matching archives.",
  description: "Scans archive roots for bracketed artist metadata, groups recurring artists, and safely moves matched archives into artist folders.",
  whenToUse: ["Use SameA before CrashU when archive names contain artist or circle metadata that should become target folders."],
  workflows: [{ title: "Extract and organize", summary: "Preview detected artists, then classify matching archives.", ui: ["Paste archive roots.", "Set the occurrence threshold and centralization mode.", "Review the plan before turning off dry run."] }],
  commands: [{ title: "Preview", command: "xiranite samea plan D:/archives/unsorted", description: "Preview artist archive organization.", examples: [] }],
  safety: { defaultMode: "dry-run", destructive: ["classify"], notes: ["Live classification moves archives and reports existing targets as conflicts."] },
} satisfies NodeHelp
