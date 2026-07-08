import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "migratef",
  name: "MigrateF",
  version: "0.1.0",
  category: "file",
  description: "Move or copy files with preserve, flat, and direct modes plus undo history.",
  icon: "FolderSync",
  keywords: ["copy", "move", "migration", "undo"],
} satisfies NodeDef

const entry = {
  def,
  core,
} satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export default entry
