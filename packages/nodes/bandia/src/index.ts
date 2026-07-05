import type { NodeEntry } from "@xiranite/contract"
import { Component } from "./Component.js"
import * as core from "./core.js"

const entry: NodeEntry<typeof core> = {
  def: {
    id: "bandia",
    name: "Bandia",
    version: "0.1.0",
    category: "file",
    description: "Batch extract, compress, repack, and export archive paths with Bandizip.",
    icon: "FileArchive",
    keywords: ["archive", "bandizip", "extract", "compress", "efu"],
  },
  Component,
  core,
}

export { Component }
export * from "./core.js"
export default entry
