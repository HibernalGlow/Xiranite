import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "timeu",
  name: "TimeU",
  version: "0.1.0",
  category: "file",
  description: "Back up and restore file timestamps from JSON records.",
  icon: "Clock3",
  keywords: ["timestamp", "backup", "restore", "mtime", "atime"],
} satisfies NodeDef

const entry = { def, core } satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export default entry
