import type { NodeEntry } from "@xiranite/contract"
import { Component } from "./Component.js"
import * as core from "./core.js"

const entry: NodeEntry<typeof core> = {
  def: {
    id: "sleept",
    name: "Sleept",
    version: "0.1.0",
    category: "system",
    description: "System timer for countdown, scheduled time, network, and CPU triggers.",
    icon: "Clock",
    keywords: ["timer", "sleep", "shutdown", "cpu", "network"],
  },
  Component,
  core,
}

export { Component }
export * from "./core.js"
export default entry
