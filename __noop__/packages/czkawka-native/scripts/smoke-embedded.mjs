import { createRequire } from "node:module"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { extractEmbeddedCzkawkaBinding } from "../dist/native-asset.js"

const assetRoot = join(import.meta.dirname, "..", "prebuilt", `${process.platform}-${process.arch}`)
const cacheRoot = join(tmpdir(), "xiranite-czkawka-embedded-smoke")
const bindingPath = extractEmbeddedCzkawkaBinding(assetRoot, cacheRoot)
const binding = createRequire(import.meta.url)(bindingPath)
console.log(JSON.stringify({ bindingPath, ...binding.getCzkawkaInfo() }))
