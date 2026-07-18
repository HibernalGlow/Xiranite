import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "transq",
  name: "TransQ",
  version: "0.1.0",
  category: "text",
  description: "Organize manga-translator result queues with native filesystem operations.",
  icon: "Languages",
  keywords: ["translation", "manga-translator", "organize", "queue"],
} satisfies NodeDef

const entry = { def, core } satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export default entry
