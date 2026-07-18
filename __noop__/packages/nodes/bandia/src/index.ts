import type { HeadlessNodePackage } from "@xiranite/contract"
import * as core from "./core.js"

export const def = {
  id: "bandia",
  name: "Bandia",
  version: "0.1.0",
  category: "file",
  description: "Batch extract, compress, repack, and export archive paths with Bandizip.",
  icon: "FileArchive",
  keywords: ["archive", "bandizip", "extract", "compress", "efu"],
}

const entry = {
  def,
  core,
} satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export * from "./interaction.js"
export default entry
