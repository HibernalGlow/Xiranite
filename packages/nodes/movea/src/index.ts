import type { NodeEntry } from "@xiranite/contract"
import { Component } from "./Component.js"
import * as core from "./core.js"

const entry: NodeEntry<typeof core> = {
  def: {
    id: "movea",
    name: "Movea",
    version: "0.1.0",
    category: "file",
    description: "Scan first-level folders and move archives or loose folders into numbered targets.",
    icon: "FolderInput",
    keywords: ["archive", "move", "folder", "classify"],
  },
  Component,
  core,
}

export { Component }
export * from "./core.js"
export default entry
