import type { NodeEntry } from "@xiranite/contract"
import { Component } from "./Component.js"
import * as core from "./core.js"

const entry: NodeEntry<typeof core> = {
  def: {
    id: "recycleu",
    name: "Recycleu",
    version: "0.1.0",
    category: "system",
    description: "Empty the Windows recycle bin immediately or on a bounded timer.",
    icon: "Trash2",
    keywords: ["recycle", "trash", "clean", "timer"],
  },
  Component,
  card: {
    blocks: [
      { id: "settings", title: "Settings", icon: "Clock", colSpan: 1 },
      { id: "status", title: "Status", icon: "Activity", colSpan: 2 },
      { id: "operation", title: "Operation", icon: "Play", colSpan: 1 },
      { id: "log", title: "Log", icon: "FileText", colSpan: 4, collapsible: true },
    ],
    defaultLayout: [
      { id: "settings", x: 0, y: 0, w: 1, h: 3, minW: 1, minH: 2 },
      { id: "status", x: 1, y: 0, w: 2, h: 3, minW: 2, minH: 2 },
      { id: "operation", x: 3, y: 0, w: 1, h: 3, minW: 1, minH: 2 },
      { id: "log", x: 0, y: 3, w: 4, h: 2, minW: 2, minH: 1 },
    ],
  },
  core,
}

export { Component }
export * from "./core.js"
export default entry
