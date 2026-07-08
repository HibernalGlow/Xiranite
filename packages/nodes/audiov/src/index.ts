import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "audiov",
  name: "AudioV",
  version: "0.1.0",
  category: "video",
  description: "Extract audio tracks from video files through PackU AudioV.",
  icon: "AudioLines",
  keywords: ["packu", "ffmpeg", "audio", "video"],
} satisfies NodeDef

const entry = { def, core } satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export default entry
