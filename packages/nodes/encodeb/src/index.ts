import type { NodeEntry } from "@xiranite/contract"
import { Component } from "./Component.js"
import * as core from "./core.js"

const entry: NodeEntry<typeof core> = {
  def: {
    id: "encodeb",
    name: "Encodeb",
    version: "0.1.0",
    category: "file",
    description: "Preview and recover garbled filenames by re-decoding path components.",
    icon: "FileText",
    keywords: ["encoding", "filename", "mojibake", "cp437", "cp936"],
  },
  Component,
  card: {
    blocks: [
      { id: "source", title: "Source", icon: "FolderOpen", colSpan: 2 },
      { id: "encoding", title: "Encoding", icon: "FileText", colSpan: 1 },
      { id: "operation", title: "Operation", icon: "Zap", colSpan: 1 },
      { id: "preview", title: "Preview", icon: "Search", colSpan: 3 },
      { id: "log", title: "Log", icon: "FileText", colSpan: 1, collapsible: true },
    ],
    defaultLayout: [
      { id: "source", x: 0, y: 0, w: 2, h: 3, minW: 1, minH: 2 },
      { id: "encoding", x: 2, y: 0, w: 1, h: 3, minW: 1, minH: 2 },
      { id: "operation", x: 3, y: 0, w: 1, h: 3, minW: 1, minH: 2 },
      { id: "preview", x: 0, y: 3, w: 3, h: 2, minW: 2, minH: 1 },
      { id: "log", x: 3, y: 3, w: 1, h: 2, minW: 1, minH: 1 },
    ],
  },
  core,
}

export { Component }
export * from "./core.js"
export default entry
