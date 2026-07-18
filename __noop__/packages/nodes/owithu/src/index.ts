import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "owithu",
  name: "Owithu",
  version: "0.1.0",
  category: "system",
  description: "Preview, register, and unregister Windows Open-with context menu entries from TOML.",
  icon: "MousePointerClick",
  keywords: ["windows", "registry", "context-menu", "open-with"],
} satisfies NodeDef

const entry = {
  def,
  core,
} satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export default entry
