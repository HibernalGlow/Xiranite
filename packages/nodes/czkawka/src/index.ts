import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "czkawka",
  name: "Czkawka",
  version: "0.1.0",
  category: "file",
  description: "Scan files with eleven Czkawka tools and manage results safely.",
  icon: "ScanSearch",
  keywords: ["duplicate", "empty", "similar", "broken", "cleanup", "czkawka"],
} satisfies NodeDef

const entry = { def, core } satisfies HeadlessNodePackage<typeof core>
export { core }
export * from "./core.js"
export * from "./filters.js"
export * from "./selection-assistant.js"
export * from "./tool-options.js"
export default entry
