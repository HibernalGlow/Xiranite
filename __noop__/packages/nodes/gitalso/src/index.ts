import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "gitalso",
  name: "GitAlso",
  version: "0.1.0",
  category: "dev",
  description: "Diny-first commit assistant with an optional GitButler AI landing workflow.",
  icon: "GitCommitHorizontal",
  keywords: ["git", "commit", "ai", "diny", "gitbutler", "also", "message"],
} satisfies NodeDef

const entry = {
  def,
  core,
} satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export default entry
