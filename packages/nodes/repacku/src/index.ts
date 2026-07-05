import type { NodeEntry } from "@xiranite/contract"
import { Component } from "./Component.js"
import * as core from "./core.js"

const entry: NodeEntry<typeof core> = {
  def: {
    id: "repacku",
    name: "Repacku",
    version: "0.1.0",
    category: "file",
    description: "Analyze folder structures and repack matching folders into zip archives.",
    icon: "Package",
    keywords: ["archive", "zip", "folder", "repack"],
  },
  Component,
  core,
}

export { Component }
export * from "./core.js"
export default entry
