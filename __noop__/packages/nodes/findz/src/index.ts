import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "findz",
  name: "Findz",
  version: "0.1.0",
  category: "file",
  description: "Search files and archive members with SQL-like filters.",
  icon: "Search",
  keywords: ["search", "archive", "filter", "find", "zip"],
} satisfies NodeDef

const entry = {
  def,
  core,
} satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export default entry
