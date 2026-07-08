import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "nameu",
  name: "NameU",
  version: "0.1.0",
  category: "file",
  description: "Rename artist archive folders with PackU NameU, TOML config, and run records.",
  icon: "FilePenLine",
  keywords: ["packu", "rename", "archive", "artist"],
} satisfies NodeDef

const entry = { def, core } satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export default entry
