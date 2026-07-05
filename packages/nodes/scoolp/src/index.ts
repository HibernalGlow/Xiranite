import type { NodeEntry } from "@xiranite/contract"
import { Component } from "./Component.js"
import * as core from "./core.js"

const entry: NodeEntry<typeof core> = {
  def: {
    id: "scoolp",
    name: "Scoolp",
    version: "0.1.0",
    category: "system",
    description: "Manage Scoop status, packages, bucket sync, and cache cleanup.",
    icon: "Package",
    keywords: ["scoop", "package-manager", "cache", "bucket"],
  },
  Component,
  core,
}

export { Component }
export * from "./core.js"
export default entry
