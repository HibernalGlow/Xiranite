import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "nameu",
  name: "NameU",
  version: "0.1.0",
  category: "file",
  description: "Preview and apply archive filename cleanup for artist folders.",
  icon: "FilePenLine",
  keywords: ["rename", "archive", "artist", "filename"],
} satisfies NodeDef

const entry = { def, core } satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export default entry
