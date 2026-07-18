import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { zipSync } from "fflate"

import { extractEmbeddedCzkawkaBinding } from "./native-asset.js"

describe("embedded native asset cache", () => {
  test("extracts, verifies, and reuses a versioned binding", () => {
    const root = join(tmpdir(), `xiranite-native-asset-${crypto.randomUUID()}`)
    const assetRoot = join(root, "embedded")
    const cacheRoot = join(root, "cache")
    mkdirSync(assetRoot, { recursive: true })
    const bindingName = `xiranite-czkawka.${process.platform}-${process.arch}.node`
    const binding = new TextEncoder().encode("binding")
    const dependency = new TextEncoder().encode("dependency")
    const archive = zipSync({ [bindingName]: binding, "dav1d.dll": dependency })
    writeFileSync(join(assetRoot, "czkawka.zip"), archive)
    writeFileSync(join(assetRoot, "manifest.json"), JSON.stringify({
      schemaVersion: 1,
      assets: [{
        id: "czkawka",
        version: "10.0.0-api2",
        platform: process.platform,
        arch: process.arch,
        archive: "czkawka.zip",
        binding: bindingName,
        sha256: hash(archive),
        files: [{ name: bindingName, sha256: hash(binding) }, { name: "dav1d.dll", sha256: hash(dependency) }],
      }],
    }))

    const first = extractEmbeddedCzkawkaBinding(assetRoot, cacheRoot)
    const second = extractEmbeddedCzkawkaBinding(assetRoot, cacheRoot)
    expect(second).toBe(first)
    expect(readFileSync(first, "utf8")).toBe("binding")
    expect(readFileSync(join(first, "..", "dav1d.dll"), "utf8")).toBe("dependency")
  })
})

function hash(value: Uint8Array): string { return createHash("sha256").update(value).digest("hex") }
