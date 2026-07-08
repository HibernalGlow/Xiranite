import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "classf",
  name: "ClassF",
  version: "0.1.0",
  category: "file",
  description: "Orchestrate classification by calling PackU samea, crashu, and migratef logic.",
  icon: "Workflow",
  keywords: ["packu", "classify", "pipeline", "samea", "crashu", "migratef"],
} satisfies NodeDef

const entry = { def, core } satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export default entry
