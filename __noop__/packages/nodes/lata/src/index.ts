import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "lata",
  name: "Lata",
  version: "0.1.0",
  category: "dev",
  description: "List, plan, and execute Taskfile tasks.",
  icon: "Rocket",
  keywords: ["taskfile", "task", "launcher", "yaml"],
} satisfies NodeDef

const entry = {
  def,
  core,
} satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export default entry
