import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, test } from "vitest"

import { parseFrontendPluginManifest } from "./pluginManifest.js"

/**
 * The `[frontend]` sample in `docs/plugin-architecture.md` §2.1 is the vocabulary's public face, so it
 * is read here by the real parser. That is the difference between a design document and a spec: if the
 * sample and the implementation ever disagree — a field renamed, a shape widened, a kind added without
 * a reader — this test is red instead of a plugin author discovering it at install time.
 */

function sectionSample(): string {
  const doc = readFileSync(resolve(import.meta.dirname, "../../../docs/plugin-architecture.md"), "utf8")
  const start = doc.indexOf("### 2.1 Plugin Manifest")
  expect(start).toBeGreaterThan(0)
  const fenceStart = doc.indexOf("```toml", start)
  const fenceEnd = doc.indexOf("\n```", fenceStart + 7)
  expect(fenceStart).toBeGreaterThan(start)
  expect(fenceEnd).toBeGreaterThan(fenceStart)
  return doc.slice(fenceStart + 7, fenceEnd).replace(/^toml\s*/, "")
}

describe("the §2.1 manifest sample", () => {
  test("is accepted by the parser, with the documented fields landing", () => {
    const toml = sectionSample()
    const result = parseFrontendPluginManifest(toml, {
      baseUrl: "https://plugins.example.com/manifest.toml",
      hostFrontendApiVersion: "1.0.0",
    })
    expect(result.ok ? [] : (result as { ok: false; issues: unknown[] }).issues).toEqual([])
    if (!result.ok) throw new Error("the document's own sample must parse")

    expect(result.manifest.id).toBe("com.example.foo")
    expect(result.manifest.frontend.entry).toBe("https://plugins.example.com/frontend/mf-manifest.json")
    expect(result.manifest.frontend.entryType).toBe("var")
    expect(result.manifest.frontend.alias).toBe("foo")
    expect(result.manifest.frontend.shareScope).toBe("default")
    expect(result.manifest.frontend.requiredApi).toBe("^1.0")
    expect(result.manifest.frontend.allowedOrigins).toEqual(["https://plugins.example.com"])
    expect(Object.keys(result.manifest.frontend.integrity ?? {})).toEqual([
      "https://plugins.example.com/remoteEntry.js",
    ])
    expect(result.manifest.contributions?.map((entry) => entry.id).sort()).toEqual(["foo.other", "foo.panel"])
  })

  test("says out loud which declared sections nothing on the frontend reads", () => {
    const result = parseFrontendPluginManifest(sectionSample(), {
      baseUrl: "https://plugins.example.com/manifest.toml",
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("the sample must parse")
    // The sample does declare both, so the notes must be the two expected entries — not silence.
    expect(result.notes).toEqual([
      "[permissions] is read by no frontend code; the host's ceiling and (later) the grant UI decide capabilities",
      "[backend] is read by crates/xiranite-node-runtime/src/manifest.rs, not by this reader",
    ])
  })
})
