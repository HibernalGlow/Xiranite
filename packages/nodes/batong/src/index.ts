import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "batong",
  name: "BATONG",
  version: "0.1.0",
  category: "dev",
  description: "Migrate drawing-workflow coding-agent sessions with Baton.",
  icon: "Route",
  keywords: ["baton", "session", "migration", "claude", "codex", "drawing"],
} satisfies NodeDef

const entry = { def, core } satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export default entry
