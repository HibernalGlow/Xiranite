import type { NodeEntry } from "@xiranite/contract"
import { Component } from "./Component.js"
import * as core from "./core.js"

const entry: NodeEntry<typeof core> = {
  def: {
    id: "reinstallp",
    name: "Reinstallp",
    version: "0.1.0",
    category: "dev",
    description: "Scan and reinstall Python editable packages with uv.",
    icon: "PackageCheck",
    keywords: ["python", "uv", "pip", "editable", "pyproject"],
  },
  Component,
  core,
}

export { Component }
export * from "./core.js"
export default entry
