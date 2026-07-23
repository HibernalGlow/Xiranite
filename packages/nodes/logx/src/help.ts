import type { NodeHelp } from "@xiranite/contract"

export const help = {
  title: "LogX",
  short: "Analyze Xiranite structured logs across GUI, CLI, and OpenTUI.",
  description: "LogX reads rotated strict JSONL logs through the shared @xiranite/logging parser and applies the same structured query and aggregation core on every surface.",
  whenToUse: ["Investigate a failed frontend or backend session.", "Group repeated errors by fingerprint.", "Validate JSONL files and retention output before sharing an incident bundle."],
  workflows: [
    { title: "Workspace GUI", summary: "Filter and inspect events without leaving Xiranite.", ui: ["Deploy LogX from the module registry.", "Choose a severity and optional scope, session, event, time, or text filter.", "Run the query and select an event to inspect its resource, attributes, and error."], tips: ["Start with warn+, then narrow by session or scope."] },
    { title: "Terminal", summary: "Use direct commands, guided mode, or OpenTUI.", cli: ["Run `xlogx query --level warn` for scripts.", "Run `xlogx` for guided mode or `xlogx ui` for OpenTUI.", "Use `xlogx doctor` to validate all discovered files."] },
  ],
  commands: [{ title: "Analyze logs", command: "xlogx", description: "Query events, sessions, statistics, errors, or integrity.", examples: [
    { label: "OpenTUI", command: "xlogx ui", description: "Open the fullscreen LogX workbench." },
    { label: "Errors", command: "xlogx errors --level error", description: "Group error fingerprints." },
    { label: "Scoped query", command: "xlogx query --scope neoview --search decode --json", description: "Return matching envelopes as JSON." },
  ] }],
  fields: [
    { name: "minimumSeverity", type: "select", description: "Minimum OpenTelemetry-style severity." },
    { name: "scope", type: "text", description: "Exact scope or scope prefix." },
    { name: "sessionId", type: "text", description: "Restrict results to one application session." },
    { name: "search", type: "text", description: "Search body, event, scope, errors, and attributes." },
  ],
  safety: { defaultMode: "read-only", notes: ["LogX never mutates source logs.", "Exported events retain their original structured envelope."] },
} satisfies NodeHelp
