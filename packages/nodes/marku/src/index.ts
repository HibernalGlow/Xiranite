import type { NodeEntry } from "@xiranite/contract"
import { Component } from "./Component.js"
import * as core from "./core.js"

const entry: NodeEntry<typeof core> = {
  def: {
    id: "marku",
    name: "Marku",
    version: "0.1.0",
    category: "text",
    description: "Run Markdown cleanup and conversion modules with preview diff.",
    icon: "FileCode",
    keywords: ["markdown", "diff", "text", "table"],
  },
  Component,
  core,
}

export { Component }
export * from "./core.js"
export default entry
