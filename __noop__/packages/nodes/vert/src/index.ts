import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "vert",
  name: "VERT",
  version: "0.1.0",
  category: "file",
  description: "Convert images, audio, video, and documents locally with CLI-first execution and a Wasm fallback.",
  icon: "RefreshCw",
  keywords: ["convert", "ffmpeg", "imagemagick", "pandoc", "wasm", "vert"],
} satisfies NodeDef

const entry = { def, core } satisfies HeadlessNodePackage<typeof core>
export { core }
export * from "./core.js"
export default entry
