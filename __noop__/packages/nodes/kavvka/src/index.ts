import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "kavvka",
  name: "Kavvka",
  version: "0.1.0",
  category: "image",
  description: "Prepare image folders for Czkawka comparison by scanning, moving siblings, and generating include paths.",
  icon: "Image",
  keywords: ["czkawka", "image", "compare", "gallery", "artist"],
} satisfies NodeDef

const entry = {
  def,
  core,
} satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export default entry
