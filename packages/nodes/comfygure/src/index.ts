import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "comfygure",
  name: "Comfygure",
  version: "0.1.0",
  category: "image",
  description: "Compile fixed generation programs into validated local ComfyUI prompt graphs.",
  icon: "Workflow",
  keywords: ["comfyui", "anima", "prompt", "lora", "compiler", "workflow"],
} satisfies NodeDef

const entry = { def, core } satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export default entry
