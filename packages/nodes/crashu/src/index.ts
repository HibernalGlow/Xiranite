import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "crashu",
  name: "Crashu",
  version: "0.1.0",
  category: "file",
  description: "Match similar folder names and optionally move matched folders.",
  icon: "Zap",
  keywords: ["folder", "similarity", "match", "move"],
} satisfies NodeDef

const entry = {
  def,
  core,
} satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export default entry
