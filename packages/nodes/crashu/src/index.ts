import type { NodeEntry } from "@xiranite/contract"
import { Component } from "./Component.js"
import * as core from "./core.js"

const entry: NodeEntry<typeof core> = {
  def: {
    id: "crashu",
    name: "Crashu",
    version: "0.1.0",
    category: "file",
    description: "Match similar folder names and optionally move matched folders.",
    icon: "Zap",
    keywords: ["folder", "similarity", "match", "move"],
  },
  Component,
  core,
}

export { Component }
export * from "./core.js"
export default entry
