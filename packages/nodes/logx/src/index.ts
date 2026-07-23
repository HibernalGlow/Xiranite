import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "logx",
  name: "LogX",
  version: "0.1.0",
  category: "dev",
  description: "Inspect, query, aggregate, and diagnose structured Xiranite logs.",
  icon: "ScrollText",
  keywords: ["log", "jsonl", "diagnostics", "errors", "sessions", "telemetry"],
} satisfies NodeDef

const entry = { def, core } satisfies HeadlessNodePackage<typeof core>
export { core }
export * from "./core.js"
export default entry
