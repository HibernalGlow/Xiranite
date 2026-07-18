import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "seriex",
  name: "Seriex",
  version: "0.1.0",
  category: "file",
  description: "Detect related archive files, plan series folders, and move them safely.",
  icon: "FolderTree",
  keywords: ["series", "archive", "manga", "organize"],
} satisfies NodeDef

const entry = {
  def,
  core,
} satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export default entry
