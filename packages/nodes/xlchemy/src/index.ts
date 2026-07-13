import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "xlchemy",
  name: "Xlchemy",
  version: "0.1.0",
  category: "media",
  description: "High-performance batch image transcoding workbench.",
  icon: "Images",
  keywords: ["image", "convert", "jxl", "avif", "webp", "psd", "clip", "transcode"],
} satisfies NodeDef

const entry = { def, core } satisfies HeadlessNodePackage<typeof core>
export { core }
export * from "./core.js"
export default entry
