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
  {
    id: "czkawka",
    info: "getCzkawkaInfo",
    requiredCapabilities: [
      "scan.duplicate",
      "scan.basic",
      "scan.media",
      "scan.bad-names",
      "scan.exif-remover",
      "operation.exif.candidate",
      "scan.video-optimizer",
      "operation.video-optimizer.candidate",
      "scan.progress.v2",
      "scan.cancel",
      "similar-images.geometric-invariance",
      "similar-images.same-resolution-exclusion",
      "similar-videos.similario",
      "similar-videos.same-resolution-exclusion",
      "similar-videos.audio",
      "broken-files.multi-checker",
      "empty-files.content-checkers",
      "temporary-files.custom-extensions",
      "operation.trash.list",
      "operation.trash.restore",
    ],
  },
]

try {
  const result = {}
  for (const spec of specs) {
    const bindingPath = extractEmbeddedNativeBinding(assetRoot, cacheRoot, spec.id)
    if (process.platform === "win32") process.env.PATH = `${join(bindingPath, "..")};${process.env.PATH ?? ""}`
    const binding = createRequire(import.meta.url)(bindingPath)
    const info = binding[spec.info]()
    if (spec.requiredCapabilities) {
      const capabilities = Array.isArray(info?.capabilities) ? info.capabilities : []
      const missing = spec.requiredCapabilities.filter((capability) => !capabilities.includes(capability))
      if (missing.length) throw new Error(`Embedded Czkawka binding is missing capability declarations: ${missing.join(", ")}`)
    }
    result[spec.id] = info
  }
  console.log(JSON.stringify(result, null, 2))
} finally {
  // Native modules keep DLL handles until process exit on Windows. The cache is
  // intentionally left for this short-lived smoke process to avoid false cleanup failures.
  await rm(cacheRoot, { recursive: true, force: true }).catch(() => {})
}
