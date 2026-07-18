import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "gifu",
  name: "Gifu",
  version: "0.1.0",
  category: "image",
  description: "Convert archive image sequences with a native TypeScript, 7-Zip, and ffmpeg workflow.",
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
