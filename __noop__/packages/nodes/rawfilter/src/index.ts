import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "rawfilter",
  name: "Rawfilter",
  version: "0.1.0",
  category: "file",
  description: "Group similar archives and move duplicate/raw versions to trash or multi.",
  icon: "Search",
  keywords: ["archive", "dedupe", "filter", "similar"],
} satisfies NodeDef

const entry = {
  def,
  core,
} satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export default entry
