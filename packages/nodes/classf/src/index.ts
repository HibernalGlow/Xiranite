import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "classf",
  name: "ClassF",
  version: "0.1.0",
  category: "file",
  description: "Orchestrate SameA artist extraction, CrashU matching, and MigrateF classification transfers.",
  icon: "Workflow",
  keywords: ["samea", "crashu", "migratef", "classify", "transfer", "archive"],
} satisfies NodeDef

const entry = { def, core } satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export default entry
