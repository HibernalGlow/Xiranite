import type { NodeEntry } from "@xiranite/contract"
import { Component } from "./Component.js"
import * as core from "./core.js"

const entry: NodeEntry<typeof core> = {
  def: {
    id: "mvz",
    name: "MVZ",
    version: "0.1.0",
    category: "file",
    description: "Delete, extract, move, or rename files inside archives from findz output.",
    icon: "Package",
    keywords: ["archive", "7z", "findz", "extract", "rename"],
  },
  Component,
  core,
}

export { Component }
export * from "./core.js"
export default entry
