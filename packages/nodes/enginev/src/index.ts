import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "enginev",
  name: "EngineV",
  version: "0.1.0",
  category: "file",
  description: "Scan, filter, rename, delete, and export Wallpaper Engine workshop folders.",
  icon: "Image",
  keywords: ["wallpaper", "workshop", "steam", "rename", "export"],
} satisfies NodeDef

const entry = {
  def,
  core,
} satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export default entry
