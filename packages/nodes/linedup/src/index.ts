import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "linedup",
  name: "Linedup",
  version: "0.1.0",
  category: "text",
  description: "Filter source lines by removing any line containing a filter token.",
  icon: "Filter",
  keywords: ["line", "filter", "dedupe", "text"],
} satisfies NodeDef

const entry = {
  def,
  core,
} satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export default entry
