import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "samea", name: "SameA", version: "0.1.0", category: "file",
  description: "Extract artist metadata from archive names and organize matching archives.", icon: "ScanSearch",
  keywords: ["artist", "archive", "organize", "extract", "classification"],
} satisfies NodeDef

const entry = { def, core } satisfies HeadlessNodePackage<typeof core>
export { core }
export * from "./core.js"
export default entry
