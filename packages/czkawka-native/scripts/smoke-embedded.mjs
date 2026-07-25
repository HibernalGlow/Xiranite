import { createRequire } from "node:module"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { extractEmbeddedCzkawkaBinding } from "../dist/native-asset.js"

const assetRoot = join(import.meta.dirname, "..", "..", "..", "native", "prebuilt", `${process.platform}-${process.arch}`)
const cacheRoot = join(tmpdir(), "xiranite-czkawka-embedded-smoke")
const bindingPath = extractEmbeddedCzkawkaBinding(assetRoot, cacheRoot)
const binding = createRequire(import.meta.url)(bindingPath)
const requiredTrashExports = ["getTrashCapabilities", "trashPath", "listTrashItems", "restoreTrashItem"]
for (const exportName of requiredTrashExports) {
  if (typeof binding[exportName] !== "function") {
    throw new Error(`Embedded Czkawka binding is missing ${exportName}`)
  }
}

const info = binding.getCzkawkaInfo()
if (info.apiVersion !== 5 || info.sourceVersion !== "10.0.0") {
  throw new Error(`Unexpected embedded Czkawka info: ${JSON.stringify(info)}`)
}
const trashCapabilities = binding.getTrashCapabilities()
if (trashCapabilities.provider !== "trash-rs" || trashCapabilities.providerVersion !== "5.2.6") {
  throw new Error(`Unexpected embedded trash capabilities: ${JSON.stringify(trashCapabilities)}`)
}
console.log(JSON.stringify({ bindingPath, ...info, trashCapabilities }))
