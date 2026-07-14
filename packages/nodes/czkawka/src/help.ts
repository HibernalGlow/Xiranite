import type { NodeHelp } from "@xiranite/contract"

export const help = {
  title: "Czkawka",
  short: "Run all eleven Czkawka scanners from GUI, CLI, or TUI.",
  description: "Uses the Czkawka Rust core only for native scanning. TypeScript owns orchestration, result filtering and sorting, selection, export, move and delete workflows.",
  whenToUse: ["Use Czkawka to inspect duplicate, empty, large, temporary, similar, invalid, broken, or incorrectly named files."],
  workflows: [{ title: "Scan and review", summary: "Choose one of eleven scanners, add roots, then inspect grouped results.", ui: ["Select a scanner from the tool rail.", "Add included and excluded directories.", "Run the scan and filter or sort results.", "Select paths before exporting, moving, or deleting."] }],
  commands: [
    { title: "Duplicates", command: "xiranite czkawka scan duplicate-files D:/media", description: "Find content duplicates using BLAKE3.", examples: [] },
    { title: "Similar images", command: "xiranite czkawka scan similar-images D:/photos --similarity 10", description: "Group perceptually similar images, including AVIF when dav1d is available.", examples: [] },
    { title: "Interactive TUI", command: "xiranite czkawka ui", description: "Open the complete OpenTUI workbench.", examples: [] },
  ],
  safety: { defaultMode: "preview", destructive: ["delete", "move"], notes: ["Delete and move default to dry-run. Pass --live only after reviewing selected paths."] },
} satisfies NodeHelp
