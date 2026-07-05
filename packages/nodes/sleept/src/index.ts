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
  card: {
    blocks: [
      { id: "mode", title: "Mode", icon: "Settings", colSpan: 2 },
      { id: "timer", title: "Timer", icon: "Clock", colSpan: 2 },
      { id: "status", title: "Status", icon: "Gauge", colSpan: 2 },
      { id: "operation", title: "Operation", icon: "Play", colSpan: 1 },
      { id: "log", title: "Log", icon: "Copy", colSpan: 2, collapsible: true },
    ],
    defaultLayout: [
      { id: "mode", x: 0, y: 0, w: 2, h: 2, minW: 1, minH: 1 },
      { id: "timer", x: 2, y: 0, w: 2, h: 2, minW: 1, minH: 1 },
      { id: "status", x: 0, y: 2, w: 3, h: 3, minW: 2, minH: 2 },
      { id: "operation", x: 3, y: 2, w: 1, h: 3, minW: 1, minH: 2 },
      { id: "log", x: 0, y: 5, w: 4, h: 2, minW: 1, minH: 1 },
    ],
  },
  core,
}

export { Component }
export * from "./core.js"
export default entry
