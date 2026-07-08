import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "classq",
  name: "ClassQ",
  version: "0.1.0",
  category: "file",
  description: "Quickly classify folders by keyword into wait/already style groups.",
  icon: "FolderTree",
  keywords: ["packu", "classify", "keyword", "folders"],
} satisfies NodeDef

const entry = { def, core } satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export default entry
