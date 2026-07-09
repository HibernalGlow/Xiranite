import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "classf",
  name: "ClassF",
  version: "0.1.0",
  category: "file",
  description: "Plan and apply native already/wait classification transfers.",
  icon: "Workflow",
  keywords: ["classify", "transfer", "already", "wait", "move"],
} satisfies NodeDef

const entry = { def, core } satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export default entry
