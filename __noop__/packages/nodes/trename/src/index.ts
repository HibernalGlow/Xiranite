import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "trename",
  name: "Trename",
  version: "0.1.0",
  category: "file",
  description: "Scan folders into rename JSON, validate translated targets, rename, and undo.",
  icon: "FilePenLine",
  keywords: ["rename", "translate", "json", "undo", "batch"],
} satisfies NodeDef

const entry = {
  def,
  core,
} satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export * from "./interaction.js"
export default entry
