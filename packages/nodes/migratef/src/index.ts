import type { NodeEntry } from "@xiranite/contract"
import { Component } from "./Component.js"
import * as core from "./core.js"

const entry: NodeEntry<typeof core> = {
  def: {
    id: "migratef",
    name: "MigrateF",
    version: "0.1.0",
    category: "file",
    description: "Move or copy files with preserve, flat, and direct modes plus undo history.",
    icon: "FolderSync",
    keywords: ["copy", "move", "migration", "undo"],
  },
  Component,
  core,
}

export { Component }
export * from "./core.js"
export default entry
