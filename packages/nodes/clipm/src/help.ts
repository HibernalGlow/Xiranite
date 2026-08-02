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
    { title: "Audit and undo feedback", command: "xclipm feedback history --active-only --json", description: "Inspect correction event IDs, then undo the latest applicable event through the same synchronized workflow.", examples: [{ label: "Undo one event", command: "xclipm feedback undo <event-id> --json", description: "Append an inverse event and synchronize the current filename and metadata." }] },
    { title: "Inspect recovery evidence", command: "xclipm recovery status --json", description: "Inspect page-level ordered similarity telemetry and its calibration state without enabling uncalibrated candidates.", examples: [] },
    { title: "Calibrate recovery", command: "xclipm recovery calibrate --json", description: "Use in-memory transformed pages and conservative cross-work negatives; enable candidates only when the safety gates pass.", examples: [] },
    { title: "Remove CM identity", command: "xclipm work remove-metadata D:/Comics/Book.cbz --json", description: "Explicitly remove one work from the ClipM database and delete its portable metadata and filename suffix.", examples: [] },
    { title: "Attempt one automatic batch", command: "xclipm train auto --batch-size 20 --json", description: "Atomically claim at most one eligible feedback batch; a failed batch is not retried in a loop.", examples: [] },
    { title: "Configure an external runtime", command: "xclipm env configure D:/ClipM --device cuda --json", description: "Validate a candidate worker before atomically switching the ClipM node configuration.", examples: [] },
    { title: "Check the environment", command: "xclipm env --json", description: "Check Python, GPU, model, database, and archive-tool health.", examples: [] },
  ],
} satisfies NodeHelp
