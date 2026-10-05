// @vitest-environment happy-dom
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, test } from "vitest"

import { classifyPluginArtifacts, enumeratePluginArtifacts, type PluginArtifact } from "./frontendIntegrity"
import { previewFrontendPluginRecord } from "./pluginManifestInstall"

const entry = "https://plugins.example.com/mf-manifest.json"
const lazy = "https://plugins.example.com/assets/lazy-note-CVsYpTB_.js"
// Verbatim copy of a real build's metadata (`examples/plugins/frontend-only/dist/mf-manifest.json`),
// committed as a fixture so the shape under test is the shape Module Federation actually emits —
// hand-written JSON here would only prove my guess about it. It includes the one `async` entry the
// lazy-loading probe in the example plugin produced.
const metadata = JSON.parse(readFileSync(resolve(import.meta.dirname, "__fixtures__/mf-manifest.sample.json"), "utf8"))
const artifacts = classifyPluginArtifacts(entry, metadata)

describe("classifyPluginArtifacts", () => {
  test("the entry, the container file, and every chunk the metadata declares", () => {
    const urls = enumeratePluginArtifacts(entry, metadata)

    expect(urls).toContain(entry)
    expect(urls).toContain("https://plugins.example.com/remoteEntry.js")
    expect(urls).toContain(lazy)
    // Measured off the committed artifact: manifest + container + 8 `sync` chunks + 1 `async` chunk.
    expect(urls.length).toBe(11)
    expect(urls.filter((url) => !url.startsWith("https://plugins.example.com/"))).toEqual([])
  })

  test("only what the runtime itself fetches is marked enforceable", () => {
    const byUrl = new Map(artifacts.map((artifact) => [artifact.url, artifact.enforceable]))

    expect(artifacts.filter((artifact) => artifact.enforceable).length).toBe(10)
    expect(byUrl.get(entry)).toBe(true)
    expect(byUrl.get("https://plugins.example.com/remoteEntry.js")).toBe(true)
    expect(byUrl.get("https://plugins.example.com/assets/vite-preload-helper-CWZBUsdZ.js")).toBe(true)
    // The async bucket: the container pulls it with a native import(), so a pin never gets consulted.
    // This is the measured negative result in §14, encoded as a shape the report cannot lose.
    expect(byUrl.get(lazy)).toBe(false)
    expect(artifacts.filter((artifact) => !artifact.enforceable).map((artifact) => artifact.url)).toEqual([lazy])
  })

  test("metadata that is not a manifest still yields the entry", () => {
    expect(enumeratePluginArtifacts(entry, undefined)).toEqual([entry])
    expect(enumeratePluginArtifacts(entry, "nonsense")).toEqual([entry])
    expect(enumeratePluginArtifacts("not-a-url", metadata)).toEqual(["not-a-url"])
  })

  test("a chunk appearing in both buckets counts as enforceable, once", () => {
    const both = {
      exposes: [{
        name: "entry",
        assets: { js: { sync: ["chunks/a.js"], async: ["chunks/a.js"] }, css: { sync: [], async: [] } },
      }],
    }

    const urls = classifyPluginArtifacts("https://plugins.example.com/mf-manifest.json", both)

    expect(urls.filter((artifact) => artifact.url.endsWith("chunks/a.js"))).toEqual([
      { url: "https://plugins.example.com/chunks/a.js", enforceable: true },
    ])  // filter+toEqual: membership of objects needs deep equality, not toContain
  })

  test("a container under a subdirectory keeps that directory", () => {
    const nested = {
      metaData: { remoteEntry: { name: "remoteEntry.js", path: "poc", type: "module" } },
      exposes: [{ name: "entry", assets: { js: { sync: ["chunks/a.js"], async: [] }, css: { sync: [], async: [] } } }],
    }

    const urls = classifyPluginArtifacts("https://plugins.example.com/dist/mf-manifest.json", nested)

    // `toContain` compares by identity, so object membership is matched explicitly here.
    expect(urls.find((a) => a.url === "https://plugins.example.com/dist/poc/remoteEntry.js")?.enforceable).toBe(true)
    expect(urls.find((a) => a.url === "https://plugins.example.com/dist/chunks/a.js")?.enforceable).toBe(true)
  })
})

describe("pin coverage over the classified set", () => {
  const pin = (letter: string) => `sha384-${letter.repeat(64)}`
  const previewWith = (integrity: Record<string, string>, listed: readonly PluginArtifact[] = artifacts) =>
    previewFrontendPluginRecord(
      { id: "com.example.coverage", entry, entryType: "module", integrity },
      { artifacts: listed },
    )

  test("it counts coverage over the enforceable set, not over everything", () => {
    const result = previewWith({ [entry]: pin("A"), "https://plugins.example.com/assets/gone-0.js": pin("B") })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected a preview")
    const preview = result.preview
    expect(preview.enumeratedArtifactCount).toBe(11)
    expect(preview.enforceableArtifactCount).toBe(10)
    expect(preview.unpinnedArtifacts).toHaveLength(9)
    expect(preview.unpinnedArtifacts).not.toContain(entry)
    // The async chunk is reported as unreachable-by-pin whether or not it carries a pin: listing it under
    // `unpinnedArtifacts` only would imply "add a pin and you are covered", which §14 measured false.
    expect(preview.unenforceableArtifacts).toEqual([lazy])
    expect(preview.pinsMatchingNothing).toEqual(["https://plugins.example.com/assets/gone-0.js"])
  })

  test("pinning the async chunk does not make it covered", () => {
    const all: Record<string, string> = {}
    for (const artifact of artifacts) all[artifact.url] = pin("C")

    const result = previewWith(all)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected a preview")
    expect(result.preview.unpinnedArtifacts).toEqual([])
    expect(result.preview.pinsMatchingNothing).toEqual([])
    // Every enforceable URL is pinned and the report still refuses to claim full-byte coverage.
    expect(result.preview.unenforceableArtifacts).toEqual([lazy])
  })

  test("without enumeration the lists are silent rather than clean", () => {
    const result = previewFrontendPluginRecord(
      { id: "com.example.coverage2", entry, entryType: "module", integrity: { [entry]: pin("A") } },
      {},
    )

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected a preview")
    expect(result.preview.artifactsEnumerated).toBe(false)
    expect(result.preview.enumeratedArtifactCount).toBe(0)
    expect(result.preview.unpinnedArtifacts).toEqual([])
    expect(result.preview.unenforceableArtifacts).toEqual([])
  })
})
