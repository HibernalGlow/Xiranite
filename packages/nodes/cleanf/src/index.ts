import type { NodeEntry } from "@xiranite/contract"
import { Component } from "./Component.js"
import * as core from "./core.js"

const entry: NodeEntry<typeof core> = {
  def: {
    id: "cleanf",
    name: "Cleanf",
    version: "0.1.0",
    category: "file",
    description: "Remove empty folders, backup files, temp folders, and trash patterns.",
    icon: "Brush",
    keywords: ["cleanup", "empty-folders", "backup", "temp"],
  },
  Component,
  core,
}

export { Component }
export * from "./core.js"
export default entry
