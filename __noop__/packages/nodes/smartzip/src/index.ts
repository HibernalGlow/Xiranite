import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "smartzip",
  name: "SmartZip",
  version: "0.1.0",
  category: "file",
  description: "TypeScript archive workflows with automatic 7-Zip discovery.",
  icon: "Archive",
  keywords: ["zip", "7zip", "archive", "extract"],
} satisfies NodeDef

const entry = {
  def,
  core,
} satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export default entry
