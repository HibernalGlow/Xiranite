import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "marku",
  name: "Marku",
  version: "0.1.0",
  category: "text",
  description: "Run Markdown cleanup and conversion modules with preview diff.",
  icon: "FileCode",
  keywords: ["markdown", "diff", "text", "table"],
} satisfies NodeDef

const entry = {
  def,
  core,
} satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export default entry
