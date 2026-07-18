import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "cleanf",
  name: "Cleanf",
  version: "0.1.0",
  category: "file",
  description: "Remove empty folders, backup files, temp folders, and trash patterns.",
  icon: "Brush",
  keywords: ["cleanup", "empty-folders", "backup", "temp"],
} satisfies NodeDef

const entry = {
  def,
  core,
} satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export default entry
