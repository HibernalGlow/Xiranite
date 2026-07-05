import type { NodeEntry } from "@xiranite/contract"
import { Component } from "./Component.js"
import * as core from "./core.js"

const entry: NodeEntry<typeof core> = {
  def: {
    id: "owithu",
    name: "Owithu",
    version: "0.1.0",
    category: "system",
    description: "Preview, register, and unregister Windows Open-with context menu entries from TOML.",
    icon: "MousePointerClick",
    keywords: ["windows", "registry", "context-menu", "open-with"],
  },
  Component,
  core,
}

export { Component }
export * from "./core.js"
export default entry
