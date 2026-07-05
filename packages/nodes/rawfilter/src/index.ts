import type { NodeEntry } from "@xiranite/contract"
import { Component } from "./Component.js"
import * as core from "./core.js"

const entry: NodeEntry<typeof core> = {
  def: {
    id: "rawfilter",
    name: "Rawfilter",
    version: "0.1.0",
    category: "file",
    description: "Group similar archives and move duplicate/raw versions to trash or multi.",
    icon: "Search",
    keywords: ["archive", "dedupe", "filter", "similar"],
  },
  Component,
  core,
}

export { Component }
export * from "./core.js"
export default entry
