import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "jellypot",
  name: "JellyPot",
  version: "0.1.0",
  category: "system",
  description: "Launch Jellyfin and PotPlayer with JellyPot configuration checks.",
  icon: "Clapperboard",
  keywords: ["jellyfin", "potplayer", "media", "launcher"],
} satisfies NodeDef

const entry = {
  def,
  core,
} satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export default entry
