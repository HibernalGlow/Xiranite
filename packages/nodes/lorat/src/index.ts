import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "lorat",
  name: "Lorat",
  version: "0.1.0",
  category: "image",
  description: "Scan LoRA models, infer triggers, write sidecars, and export TriggerDB JSON.",
  icon: "Tags",
  keywords: ["lora", "trigger", "comfyui", "sidecar", "triggerdb"],
} satisfies NodeDef

const entry = {
  def,
  core,
} satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export default entry
