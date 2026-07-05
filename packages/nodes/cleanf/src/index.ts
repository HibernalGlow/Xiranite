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
  card: {
    blocks: [
      { id: "source", title: "Source", icon: "FolderOpen", colSpan: 2 },
      { id: "presets", title: "Presets", icon: "ListChecks", colSpan: 1 },
      { id: "options", title: "Options", icon: "SlidersHorizontal", colSpan: 1 },
      { id: "result", title: "Result", icon: "Brush", colSpan: 3 },
      { id: "log", title: "Log", icon: "FileText", colSpan: 1, collapsible: true },
    ],
    defaultLayout: [
      { id: "source", x: 0, y: 0, w: 2, h: 3, minW: 1, minH: 2 },
      { id: "presets", x: 2, y: 0, w: 1, h: 3, minW: 1, minH: 2 },
      { id: "options", x: 3, y: 0, w: 1, h: 3, minW: 1, minH: 2 },
      { id: "result", x: 0, y: 3, w: 3, h: 2, minW: 2, minH: 1 },
      { id: "log", x: 3, y: 3, w: 1, h: 2, minW: 1, minH: 1 },
    ],
  },
  core,
}

export { Component }
export * from "./core.js"
export default entry
