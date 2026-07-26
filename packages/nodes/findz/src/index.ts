import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "findz",
  name: "Findz",
  version: "0.1.0",
  category: "file",
  description: "Incrementally index ZIP and CBZ libraries, then analyze image headers on demand.",
  icon: "Search",
  keywords: ["search", "archive", "zip", "cbz", "analysis", "treemap"],
} satisfies NodeDef

const entry = {
  def,
  core,
} satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export default entry
