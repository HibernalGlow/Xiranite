import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "classq",
  name: "ClassQ",
  version: "0.1.0",
  category: "file",
  description: "Find keyword folders and plan sibling items into wait folders.",
  icon: "FolderTree",
  keywords: ["classify", "keyword", "folders", "wait"],
} satisfies NodeDef

const entry = { def, core } satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export default entry
