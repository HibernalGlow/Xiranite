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
  core,
}

export { Component }
export * from "./core.js"
export default entry
