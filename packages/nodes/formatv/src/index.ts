import type { NodeEntry } from "@xiranite/contract"
import { Component } from "./Component.js"
import * as core from "./core.js"

const entry: NodeEntry<typeof core> = {
  def: {
    id: "formatv",
    name: "FormatV",
    version: "0.1.0",
    category: "video",
    description: "Scan video folders, add/remove .nov suffixes, and check prefixed duplicates.",
    icon: "Video",
    keywords: ["video", "nov", "duplicate", "prefix"],
  },
  Component,
  core,
}

export { Component }
export * from "./core.js"
export default entry
