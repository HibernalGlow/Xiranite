import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "synct",
  name: "Synct",
  version: "0.1.0",
  category: "file",
  description: "Archive folders and files by extracted timestamps with PackU Synct.",
  icon: "CalendarClock",
  keywords: ["packu", "timestamp", "archive", "sync"],
} satisfies NodeDef

const entry = { def, core } satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export default entry
