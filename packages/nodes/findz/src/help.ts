import type { NodeHelp } from "@xiranite/contract"

/// Kept because `scripts/audit-node-cli-surface.ts` reads it as the node's terminal-face sentence.
export const FINDZ_GUI_ONLY_HELP = "Findz v2 is operated from the Xiranite workspace GUI.";

const actions = [
  "open a library by root, then scan it incrementally",
  "query, page and export archive rows, and drill into member rows",
  "run image-header analysis over members and read the warnings back",
  "project a treemap of the library",
  "pause, resume, cancel or wait on a durable scan task",
];

export const help = {
  title: "Findz",
  // The definition file's own sentence, published here rather than restated: `audit:node-help-text`
  // requires every `node-definitions/findz.json` description to come from this dictionary, so the node
  // keeps one vocabulary for the card, the CLI surface and the help page.
  short: "Search files and archive members with SQL-like filters.",
  description:
    "The indexing core is Go (native/findz-go) and runs as a child process owned by one run: one SQLite index per library, durable scan and analysis tasks, and a host-owned filesystem watch that feeds changes into the index. TypeScript holds only the action vocabulary.",
  whenToUse: [
    "Use Findz to search archives and their members across a large library without extracting them.",
    `Available actions: ${actions.join("; ")}.`,
  ],
  workflows: [
    {
      title: "Workspace UI",
      summary: "Open a library by its root, then scan, query, analyse and project it.",
      ui: [
        "Type or pick the library root and open it — the index location is chosen by the host, not by the node, and the answer reports where it was placed.",
        "Start a scan; the run waits on the durable task and reports progress, so a long first scan stays open rather than returning a partial count.",
        "Query and page rows, or export them; open an archive row to inspect its member rows.",
        "Run image-header analysis and read `completed_with_warnings` when a member's bytes are unreadable.",
        "Use the header controls to pause, resume or cancel the in-flight task; pausing stops the engine's task, not just the screen.",
        "A file added or removed inside the library while the run is alive is applied to the index before the next query answers; `watcherHealth` says when that feed degraded.",
      ],
    },
    {
      title: "CLI",
      summary: "Findz has no terminal workflow: the node command points at the workspace UI.",
      cli: [
        "`xiranite findz --help` documents this, and the command prints that Findz is operated from the Xiranite workspace GUI.",
        "Drive the same actions over the host's `/operations` protocol if you need them programmatically.",
      ],
    },
  ],
  commands: [
    {
      title: "Terminal entry",
      command: "xiranite findz",
      description: "Reports that this node is driven from the workspace GUI; it runs no indexing work itself.",
      examples: [],
    },
  ],
  safety: {
    defaultMode: "read-only",
    destructive: [],
    notes: [
      "Findz reads archives and writes only its own index; it never moves, renames or deletes library files.",
      "A watch batch that reports a removal deletes index rows for that path, not the files on disk.",
      "The library root is checked against the operation's grant before the engine sees the path, and the canonical form is what the engine receives.",
    ],
  },
  translations: {
    zh: {
      short: "使用类 SQL 过滤条件搜索文件与归档成员。",
      description: "使用类 SQL 过滤条件搜索文件与归档成员。",
    },
  },
} satisfies NodeHelp;
