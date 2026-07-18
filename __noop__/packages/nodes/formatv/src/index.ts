import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "formatv",
  name: "FormatV",
  version: "0.1.0",
  category: "video",
  description: "Scan video folders, add/remove .nov suffixes, and check prefixed duplicates.",
  icon: "Video",
  keywords: ["video", "nov", "duplicate", "prefix"],
} satisfies NodeDef

const entry = {
  def,
  core,
} satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export default entry
