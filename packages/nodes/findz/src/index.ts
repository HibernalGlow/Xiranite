import type { NodeEntry } from "@xiranite/contract"
import { Component } from "./Component.js"
import * as core from "./core.js"

const entry: NodeEntry<typeof core> = {
  def: {
    id: "findz",
    name: "Findz",
    version: "0.1.0",
    category: "file",
    description: "Search files and archive members with SQL-like filters.",
    icon: "Search",
    keywords: ["search", "archive", "filter", "find", "zip"],
  },
  Component,
  core,
}

export { Component }
export * from "./core.js"
export default entry
