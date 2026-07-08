import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "gifu",
  name: "Gifu",
  version: "0.1.0",
  category: "image",
  description: "Scan archive image sequences and run gifu animation conversion.",
  icon: "Film",
  keywords: ["gif", "webp", "archive", "animation", "ffmpeg"],
} satisfies NodeDef

const entry = {
  def,
  core,
} satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export default entry
