import { createRequire } from "node:module"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { extractEmbeddedNativeBinding } from "../dist/index.js"

const workspaceRoot = resolve(import.meta.dirname, "..", "..", "..")
const assetRoot = join(workspaceRoot, "build", "wails", "native-assets")
const cacheRoot = await mkdtemp(join(tmpdir(), "xiranite-embedded-native-smoke-"))
const specs = [
  { id: "arcthumb", info: "getArcThumbInfo" },
  { id: "czkawka", info: "getCzkawkaInfo" },
]

try {
  const result = {}
  for (const spec of specs) {
    const bindingPath = extractEmbeddedNativeBinding(assetRoot, cacheRoot, spec.id)
    if (process.platform === "win32") process.env.PATH = `${join(bindingPath, "..")};${process.env.PATH ?? ""}`
    const binding = createRequire(import.meta.url)(bindingPath)
    result[spec.id] = binding[spec.info]()
  }
  console.log(JSON.stringify(result, null, 2))
} finally {
  // Native modules keep DLL handles until process exit on Windows. The cache is
  // intentionally left for this short-lived smoke process to avoid false cleanup failures.
  await rm(cacheRoot, { recursive: true, force: true }).catch(() => {})
}
