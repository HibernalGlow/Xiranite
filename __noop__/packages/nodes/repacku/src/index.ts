import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "repacku",
  name: "Repacku",
  version: "0.1.0",
  category: "file",
  description: "Analyze folder structures and repack matching folders into zip archives.",
  icon: "Package",
  keywords: ["archive", "zip", "folder", "repack"],
} satisfies NodeDef

const entry = {
  def,
  core,
} satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export default entry
