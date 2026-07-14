import type { NodeHelp } from "@xiranite/contract"

export const help = {
  title: "Czkawka",
  short: "Run all eleven Czkawka scanners from GUI, CLI, or TUI.",
  description: "Uses the Czkawka Rust core only for native scanning. TypeScript owns orchestration, result filtering and sorting, selection, export, move and delete workflows.",
  whenToUse: ["Use Czkawka to inspect duplicate, empty, large, temporary, similar, invalid, broken, or incorrectly named files."],
  workflows: [{ title: "Scan and review", summary: "Choose one of eleven scanners, add roots, then inspect grouped results.", ui: ["Select a scanner from the tool rail.", "Add included and excluded directories.", "Save reusable scan settings as a versioned preset when needed.", "Run the scan and filter or sort results.", "Select paths before exporting, moving, renaming, or deleting."] }],
  commands: [
    { title: "Duplicates", command: "xiranite czkawka scan duplicate-files D:/media", description: "Find content duplicates using BLAKE3.", examples: [] },
    { title: "Similar images", command: "xiranite czkawka scan similar-images D:/photos --similarity 10", description: "Group perceptually similar images, including AVIF when dav1d is available.", examples: [] },
    { title: "Safe delete", command: "xiranite czkawka delete D:/old.tmp", description: "Preview moving a path to the recycle bin; add --live to execute or --permanent for explicit permanent deletion.", examples: [] },
    { title: "Copy with structure", command: "xiranite czkawka move E:/Review D:/photos/a.jpg --copy --preserve-structure --conflict rename", description: "Preview a root-relative copy and automatically number conflicting names.", examples: [] },
    { title: "Fix extensions", command: "xiranite czkawka rename jpg D:/photo.bin", description: "Preview correcting one or more file extensions; add --live after reviewing targets.", examples: [] },
    { title: "Export CSV", command: "xiranite czkawka save D:/results.csv D:/photo.jpg --csv --scope selected", description: "Export result rows as structured JSON or full-field CSV.", examples: [] },
    { title: "Interactive TUI", command: "xiranite czkawka ui", description: "Open the complete OpenTUI workbench.", examples: [] },
  ],
  safety: { defaultMode: "preview", destructive: ["delete", "move", "rename"], notes: ["Delete, move, and rename default to dry-run. Pass --live only after reviewing selected paths and targets.", "Live deletion defaults to the Windows recycle bin; permanent deletion requires --permanent.", "Move/copy/rename conflicts can be skipped, overwritten, auto-renamed, or reported as errors."] },
} satisfies NodeHelp
