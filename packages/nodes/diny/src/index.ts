import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "diny",
  name: "Diny",
  version: "0.1.0",
  category: "dev",
  description: "AI-powered git commit message generator wrapping the diny binary.",
  icon: "GitCommitHorizontal",
  keywords: ["git", "commit", "ai", "diny", "message"],
} satisfies NodeDef

const entry = {
  def,
  core,
} satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export default entry
