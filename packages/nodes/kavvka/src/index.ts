import type { NodeEntry } from "@xiranite/contract"
import { Component } from "./Component.js"
import * as core from "./core.js"

const entry: NodeEntry<typeof core> = {
  def: {
    id: "kavvka",
    name: "Kavvka",
    version: "0.1.0",
    category: "image",
    description: "Prepare image folders for Czkawka comparison by scanning, moving siblings, and generating include paths.",
    icon: "Image",
    keywords: ["czkawka", "image", "compare", "gallery", "artist"],
  },
  Component,
  core,
}

export { Component }
export * from "./core.js"
export default entry
