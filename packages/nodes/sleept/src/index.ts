import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "sleept",
  name: "Sleept",
  version: "0.1.0",
  category: "system",
  description: "System timer for countdown, scheduled time, network, and CPU triggers.",
  icon: "Clock",
  keywords: ["timer", "sleep", "shutdown", "cpu", "network"],
} satisfies NodeDef

const entry = {
  def,
  core,
} satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export * from "./i18n.js"
export * from "./interaction.js"
export default entry
