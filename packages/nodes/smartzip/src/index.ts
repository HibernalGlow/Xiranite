import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "smartzip",
  name: "SmartZip",
  version: "0.1.0",
  category: "file",
  description: "Plan and launch SmartZip archive open, extract, and compress workflows.",
  icon: "Archive",
  keywords: ["zip", "7zip", "archive", "ahk", "extract"],
} satisfies NodeDef

const entry = {
  def,
  core,
} satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export default entry
