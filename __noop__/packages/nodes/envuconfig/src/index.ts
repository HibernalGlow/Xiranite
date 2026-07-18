import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "envuconfig",
  name: "EnvU Config",
  version: "0.1.0",
  category: "system",
  description: "Inventory, record, and back up EnvU installation configuration files.",
  icon: "Archive",
  keywords: ["envu", "config", "backup", "dotfiles", "registry"],
} satisfies NodeDef

const entry = {
  def,
  core,
} satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export default entry
