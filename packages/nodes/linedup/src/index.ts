import type { NodeEntry } from "@xiranite/contract"
import { Component } from "./Component.js"
import * as core from "./core.js"

const entry: NodeEntry<typeof core> = {
  def: {
    id: "linedup",
    name: "Linedup",
    version: "0.1.0",
    category: "text",
    description: "Filter source lines by removing any line containing a filter token.",
    icon: "Filter",
    keywords: ["line", "filter", "dedupe", "text"],
  },
  Component,
  card: {
    blocks: [
      { id: "source", title: "Source", icon: "FileText", colSpan: 2 },
      { id: "filter", title: "Filter", icon: "Filter", colSpan: 2 },
      { id: "operation", title: "Operation", icon: "Play", colSpan: 1 },
      { id: "result", title: "Result", icon: "List", colSpan: 2, fullHeight: true },
      { id: "log", title: "Log", icon: "FileText", colSpan: 1, collapsible: true },
    ],
    defaultLayout: [
      { id: "source", x: 0, y: 0, w: 2, h: 2, minW: 1, minH: 1 },
      { id: "filter", x: 2, y: 0, w: 2, h: 2, minW: 1, minH: 1 },
      { id: "operation", x: 0, y: 2, w: 1, h: 3, minW: 1, minH: 2 },
      { id: "result", x: 1, y: 2, w: 2, h: 3, minW: 1, minH: 2 },
      { id: "log", x: 3, y: 2, w: 1, h: 3, minW: 1, minH: 1 },
    ],
  },
  core,
}

export { Component }
export * from "./core.js"
export default entry
