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
  core,
}

export { Component }
export * from "./core.js"
export default entry
