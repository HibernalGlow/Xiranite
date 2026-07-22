import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"
export const def = { id: "melodeck", name: "Melodeck", version: "0.1.0", category: "audio", description: "Local music playback deck backed by mpv JSON IPC.", icon: "Music2", keywords: ["music", "audio", "player", "mpv", "playlist"] } satisfies NodeDef
const entry = { def, core } satisfies HeadlessNodePackage<typeof core>
export { core }
export * from "./core.js"
export default entry
