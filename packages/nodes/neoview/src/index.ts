import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "neoview",
  name: "NeoView",
  version: "0.1.0",
  category: "image",
  description: "High-performance image and comic reader with shared GUI, CLI, and TUI core.",
  icon: "BookOpen",
  keywords: ["reader", "comic", "cbz", "archive", "image"],
} satisfies NodeDef

const entry = { def, core } satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./archive.js"
export * from "./core.js"
export * from "./frame.js"
export * from "./session.js"
export default entry
