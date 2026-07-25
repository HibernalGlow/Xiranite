import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { zipSync } from "fflate"

import { extractEmbeddedNativeBinding } from "./index.js"

describe("embedded native asset cache", () => {
  test("extracts, verifies, and reuses a versioned binding", () => {
    const root = join(tmpdir(), `xiranite-native-asset-${crypto.randomUUID()}`)
    const assetRoot = join(root, "embedded")
    const cacheRoot = join(root, "cache")
    mkdirSync(assetRoot, { recursive: true })
    const bindingName = `xiranite-slimg.${process.platform}-${process.arch}.node`
    const binding = new TextEncoder().encode("binding")
    const dependency = new TextEncoder().encode("dependency")
    const archive = zipSync({ [bindingName]: binding, "dav1d.dll": dependency })
    writeFileSync(join(assetRoot, "slimg.zip"), archive)
    writeFileSync(join(assetRoot, "manifest.json"), JSON.stringify({
      schemaVersion: 1,
      assets: [{
        id: "slimg",
        version: "0.1.0-api1",
        platform: process.platform,
        arch: process.arch,
        archive: "slimg.zip",
        binding: bindingName,
        sha256: hash(archive),
        files: [{ name: bindingName, sha256: hash(binding) }, { name: "dav1d.dll", sha256: hash(dependency) }],
      }],
    }))

    const first = extractEmbeddedNativeBinding(assetRoot, cacheRoot, "slimg")
    const second = extractEmbeddedNativeBinding(assetRoot, cacheRoot, "slimg")
    expect(second).toBe(first)
    expect(readFileSync(first, "utf8")).toBe("binding")
    expect(readFileSync(join(first, "..", "dav1d.dll"), "utf8")).toBe("dependency")
  })
})

function hash(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex")
}
