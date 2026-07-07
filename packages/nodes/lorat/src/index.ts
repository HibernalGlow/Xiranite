import type { NodeEntry } from "@xiranite/contract"
import { Component } from "./Component.js"
import * as core from "./core.js"

const entry: NodeEntry<typeof core> = {
  def: {
    id: "lorat",
    name: "Lorat",
    version: "0.1.0",
    category: "image",
    description: "Scan LoRA models, infer triggers, write sidecars, and export TriggerDB JSON.",
    icon: "Tags",
    keywords: ["lora", "trigger", "comfyui", "sidecar", "triggerdb"],
  },
  Component,
  core,
}

export { Component }
export * from "./core.js"
export default entry
