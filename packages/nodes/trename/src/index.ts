import type { NodeEntry } from "@xiranite/contract"
import { Component } from "./Component.js"
import * as core from "./core.js"

const entry: NodeEntry<typeof core> = {
  def: {
    id: "trename",
    name: "Trename",
    version: "0.1.0",
    category: "file",
    description: "Scan folders into rename JSON, validate translated targets, rename, and undo.",
    icon: "FilePenLine",
    keywords: ["rename", "translate", "json", "undo", "batch"],
  },
  Component,
  core,
}

export { Component }
export * from "./core.js"
export default entry
