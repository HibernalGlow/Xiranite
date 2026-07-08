import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "snf",
  name: "SNF",
  version: "0.1.0",
  category: "file",
  description: "Repair numbered folder sequence order with PackU SNF.",
  icon: "ListOrdered",
  keywords: ["packu", "sequence", "folder", "rename"],
} satisfies NodeDef

const entry = { def, core } satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export default entry
