import type { NodeHelp } from "@xiranite/contract"

export const help = {
  title: "CoverU",
  short: "Extract cover images from archives and image folders.",
  description: "Plan and extract cover files from ZIP/CBZ archives or loose image inputs without a Python adapter.",
  whenToUse: [
    "Use CoverU when archive cover files need to be detected, reviewed, and extracted into a predictable output location.",
  ],
  workflows: [
    {
      title: "Workspace UI",
      summary: "Paste archive or folder paths, review the cover contact sheet, then extract selected cover candidates.",
      ui: [
        "Paste ZIP/CBZ archives, loose image files, or folders that contain them.",
        "Run scan or plan to inspect cover candidates and unsupported archives.",
        "Switch from preview to extract only after the output directory and overwrite policy are correct.",
      ],
    },
    {
      title: "CLI",
      summary: "Run CoverU directly from a terminal.",
      cli: [
        "Run `xiranite coveru plan <path>` to inspect cover candidates.",
        "Run `xiranite coveru extract <path> --output-dir <dir>` to write cover files.",
      ],
    },
  ],
  commands: [
    {
      title: "Plan cover extraction",
      command: "xiranite coveru plan D:/archives",
      description: "Inspect archives and print a summary without writing files.",
      examples: [
        {
          label: "Extract to a directory",
          command: "xiranite coveru extract D:/archives --output-dir D:/covers",
          description: "Extract detected covers into one output folder.",
        },
        {
          label: "Allow overwrite",
          command: "xiranite coveru extract D:/archives --output-dir D:/covers --overwrite",
          description: "Replace existing output files when names collide.",
        },
      ],
    },
  ],
  safety: {
    defaultMode: "preview",
    notes: [
      "Plan first when processing a large folder.",
      "Overwrite is disabled by default.",
      "Unsupported archive formats are reported instead of invoking external tools.",
    ],
  },
} satisfies NodeHelp
