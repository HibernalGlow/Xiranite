import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "dissolvef",
  name: "Dissolvef",
  version: "0.1.0",
  category: "file",
  description: "Dissolve nested, single-media, single-archive, or direct folders with undo history.",
  icon: "FolderInput",
  keywords: ["folder", "dissolve", "flatten", "archive", "media", "undo"],
} satisfies NodeDef

const entry = {
  def,
  core,
} satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export default entry
