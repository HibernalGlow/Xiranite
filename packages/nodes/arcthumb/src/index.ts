import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "arcthumb",
  name: "ArcThumb",
  version: "0.1.0",
  category: "image",
  description: "Generate native cover thumbnails from comic archives and ebooks.",
  icon: "GalleryThumbnails",
  keywords: ["thumbnail", "cover", "archive", "ebook", "cbz", "epub"],
} satisfies NodeDef

const entry = { def, core } satisfies HeadlessNodePackage<typeof core>
export { core }
export * from "./core.js"
export default entry
