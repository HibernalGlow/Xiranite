import type { NodeEntry } from "@xiranite/contract"
import { Component } from "./Component.js"
import * as core from "./core.js"

const entry: NodeEntry<typeof core> = {
  def: {
    id: "linku",
    name: "Linku",
    version: "0.1.0",
    category: "file",
    description: "Create, move, list, and recover symlink records.",
    icon: "Link",
    keywords: ["symlink", "link", "move", "recover"],
  },
  Component,
  core,
}

export { Component }
export * from "./core.js"
export default entry
