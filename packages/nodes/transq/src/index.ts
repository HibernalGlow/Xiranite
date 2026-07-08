import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "transq",
  name: "TransQ",
  version: "0.1.0",
  category: "text",
  description: "Organize translation result files with PackU TransQ.",
  icon: "Languages",
  keywords: ["packu", "translation", "organize", "queue"],
} satisfies NodeDef

const entry = { def, core } satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export default entry
