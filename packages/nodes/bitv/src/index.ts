import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "bitv",
  name: "BitV",
  version: "0.1.0",
  category: "video",
  description: "Analyze and classify video bitrate with PackU BitV.",
  icon: "Gauge",
  keywords: ["packu", "video", "bitrate", "classification"],
} satisfies NodeDef

const entry = { def, core } satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export default entry
