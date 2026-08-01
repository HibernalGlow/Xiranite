import type { NodeHelp } from "@xiranite/contract"

export const help = {
  title: "ClipM",
  short: "Score comics and manage personal preference corrections and models.",
  description: "Uses the shared Python ClipM service to score comic works, synchronize CM metadata, import corrections, train preference heads, and manage model versions.",
  whenToUse: ["Rank a folder of comic archives or extracted comic folders.", "Review filename corrections or retrain the preference heads."],
  workflows: [
    { title: "Score a library", summary: "Choose one folder and run ClipM.", ui: ["Existing current scores are reused by default.", "Enable rescore only when a fresh embedding and prediction are required."] },
    { title: "Correct and retrain", summary: "Import or apply corrections, then validate new classification and ranking heads.", ui: ["Classification and numerical ranking are independent fields.", "Rejected candidates remain available for inspection without automatic activation."] },
  ],
  commands: [
    { title: "Score a folder", command: "xclipm score D:/Comics --json", description: "Score and synchronize one comic library through the ClipM MCP worker.", examples: [{ label: "Preview without writing", command: "xclipm score D:/Comics --dry-run --json", description: "Inspect proposed results without changing files." }] },
    { title: "Check the environment", command: "xclipm env --json", description: "Check Python, GPU, model, database, and archive-tool health.", examples: [] },
  ],
} satisfies NodeHelp
