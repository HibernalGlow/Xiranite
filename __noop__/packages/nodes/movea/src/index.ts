import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "movea",
  name: "Movea",
  version: "0.1.0",
  category: "file",
  description: "Scan first-level folders and move archives or loose folders into numbered targets.",
  icon: "FolderInput",
  keywords: ["archive", "move", "folder", "classify"],
} satisfies NodeDef

const entry = {
  def,
  core,
} satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export default entry
