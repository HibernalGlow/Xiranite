import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "coveru",
  name: "CoverU",
  version: "0.1.0",
  category: "image",
  description: "Extract cover images from archives and image folders.",
  icon: "Image",
  keywords: ["cover", "archive", "zip", "cbz", "image"],
} satisfies NodeDef

const entry = { def, core } satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export default entry
