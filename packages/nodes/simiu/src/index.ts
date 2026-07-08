import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "simiu",
  name: "Simiu",
  version: "0.1.0",
  category: "image",
  description: "Scan image folders and group similar files into managed sets.",
  icon: "Images",
  keywords: ["image", "similarity", "grouping", "dedupe"],
} satisfies NodeDef

const entry = {
  def,
  core,
} satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export default entry
