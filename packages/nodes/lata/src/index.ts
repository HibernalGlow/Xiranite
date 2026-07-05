import type { NodeEntry } from "@xiranite/contract"
import { Component } from "./Component.js"
import * as core from "./core.js"

const entry: NodeEntry<typeof core> = {
  def: {
    id: "lata",
    name: "Lata",
    version: "0.1.0",
    category: "dev",
    description: "List, plan, and execute Taskfile tasks.",
    icon: "Rocket",
    keywords: ["taskfile", "task", "launcher", "yaml"],
  },
  Component,
  core,
}

export { Component }
export * from "./core.js"
export default entry
