import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"
export const def = { id: "soundw", name: "SoundW", version: "0.1.0", category: "system", description: "Quickly switch SoundSwitch recording devices and microphone mute state.", icon: "Mic", keywords: ["audio", "microphone", "soundswitch", "mute"] } satisfies NodeDef
const entry = { def, core } satisfies HeadlessNodePackage<typeof core>
export { core }; export * from "./core.js"; export default entry
