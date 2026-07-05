import type { NodeEntry } from "@xiranite/contract"
import { Component } from "./Component.js"
import * as core from "./core.js"

const entry: NodeEntry<typeof core> = {
  def: {
    id: "seriex",
    name: "Seriex",
    version: "0.1.0",
    category: "file",
    description: "Detect related archive files, plan series folders, and move them safely.",
    icon: "FolderTree",
    keywords: ["series", "archive", "manga", "organize"],
  },
  Component,
  core,
}

export { Component }
export * from "./core.js"
export default entry
