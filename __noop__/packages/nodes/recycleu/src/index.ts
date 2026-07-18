import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "recycleu",
  name: "Recycleu",
  version: "0.1.0",
  category: "system",
  description: "Empty the Windows recycle bin immediately or on a bounded timer.",
  icon: "Trash2",
  keywords: ["recycle", "trash", "clean", "timer"],
} satisfies NodeDef

const entry = {
  def,
  core,
} satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export default entry
