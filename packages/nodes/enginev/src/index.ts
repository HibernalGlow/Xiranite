import type { NodeEntry } from "@xiranite/contract"
import { Component } from "./Component.js"
import * as core from "./core.js"

const entry: NodeEntry<typeof core> = {
  def: {
    id: "enginev",
    name: "EngineV",
    version: "0.1.0",
    category: "file",
    description: "Scan, filter, rename, delete, and export Wallpaper Engine workshop folders.",
    icon: "Image",
    keywords: ["wallpaper", "workshop", "steam", "rename", "export"],
  },
  Component,
  core,
}

export { Component }
export * from "./core.js"
export default entry
