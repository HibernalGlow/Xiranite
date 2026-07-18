import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "linku",
  name: "Linku",
  version: "0.1.0",
  category: "file",
  description: "Create, move, list, and recover symlink records.",
  icon: "Link",
  keywords: ["symlink", "link", "move", "recover"],
} satisfies NodeDef

const entry = {
  def,
  core,
} satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export default entry
