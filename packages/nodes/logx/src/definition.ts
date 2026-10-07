import type { NodeDef } from "@xiranite/contract"

export const def = {
  id: "logx",
  name: "LogX",
  version: "0.1.0",
  category: "dev",
  description: "Inspect, query, aggregate, and diagnose structured Xiranite logs.",
  icon: "ScrollText",
  keywords: ["log", "jsonl", "diagnostics", "errors", "sessions", "telemetry"],
} satisfies NodeDef
