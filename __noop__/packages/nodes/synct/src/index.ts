import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "synct",
  name: "Synct",
  version: "0.1.0",
  category: "file",
  description: "Archive files and folders into date-based paths from extracted timestamps.",
  icon: "CalendarClock",
  keywords: ["timestamp", "archive", "sync", "date"],
} satisfies NodeDef

const entry = { def, core } satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export default entry
