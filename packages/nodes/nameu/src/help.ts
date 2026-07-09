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
} satisfies NodeHelp
