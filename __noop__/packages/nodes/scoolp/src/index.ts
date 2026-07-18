import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "scoolp",
  name: "Scoolp",
  version: "0.1.0",
  category: "system",
  description: "Manage Scoop status, packages, bucket sync, and cache cleanup.",
  icon: "Package",
  keywords: ["scoop", "package-manager", "cache", "bucket"],
} satisfies NodeDef

const entry = {
  def,
  core,
} satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export * from "./interaction.js"
export default entry
