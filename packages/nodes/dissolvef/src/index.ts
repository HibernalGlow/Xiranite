import type { NodeEntry } from "@xiranite/contract"
import { Component } from "./Component.js"
import * as core from "./core.js"

const entry: NodeEntry<typeof core> = {
  def: {
    id: "dissolvef",
    name: "DissolveF",
    version: "0.1.0",
    category: "file",
    description: "Dissolve nested, single-media, single-archive, or direct folders with undo history.",
    icon: "FolderInput",
    keywords: ["folder", "dissolve", "flatten", "archive", "media", "undo"],
  },
  Component,
  core,
}

export { Component }
export * from "./core.js"
export default entry
