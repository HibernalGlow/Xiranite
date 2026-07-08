import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "coveru",
  name: "CoverU",
  version: "0.1.0",
  category: "image",
  description: "Extract and convert archive cover images with PackU CoverU.",
  icon: "Image",
  keywords: ["packu", "cover", "archive", "jxl", "avif"],
} satisfies NodeDef

const entry = { def, core } satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export default entry
