// @vitest-environment happy-dom
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, test } from "vitest"

import { enumeratePluginArtifacts } from "./frontendIntegrity"
import { previewFrontendPluginRecord } from "./pluginManifestInstall"

const entry = "https://plugins.example.com/mf-manifest.json"
// Verbatim copy of a real build's metadata (`examples/plugins/frontend-only/dist/mf-manifest.json`),
// committed as a fixture so the shape under test is the shape Module Federation actually emits —
// hand-written JSON here would only prove my guess about it.
const metadata = JSON.parse(readFileSync(resolve(import.meta.dirname, "__fixtures__/mf-manifest.sample.json"), "utf8"))

describe("enumeratePluginArtifacts", () => {
  test("the entry, the container file, and every chunk the metadata declares", () => {
    const urls = enumeratePluginArtifacts(entry, metadata)

    expect(urls).toContain(entry)
    expect(urls).toContain("https://plugins.example.com/remoteEntry.js")
    expect(urls).toContain("https://plugins.example.com/assets/entry-CnFRqkN7.js")
    // Measured off the committed artifact: the manifest, the container, and 8 expose chunks. Nothing
    // lands in `assets.js.async` for this build, which is why §6 still calls lazy-chunk coverage unproven.
    expect(urls.length).toBe(10)
    expect(urls.filter((url) => !url.startsWith("https://plugins.example.com/"))).toEqual([])
  })

  test("metadata that is not a manifest still yields the entry", () => {
    expect(enumeratePluginArtifacts(entry, undefined)).toEqual([entry])
    expect(enumeratePluginArtifacts(entry, "nonsense")).toEqual([entry])
    // An entry that is not even a URL cannot anchor siblings, so the honest answer is the entry alone.
    expect(enumeratePluginArtifacts("not-a-url", metadata)).toEqual(["not-a-url"])
  })

  test("a container under a subdirectory keeps that directory", () => {
    const nested = {
      metaData: { remoteEntry: { name: "remoteEntry.js", path: "poc", type: "module" } },
      exposes: [{ name: "entry", assets: { js: { sync: ["chunks/a.js"], async: [] }, css: { sync: [], async: [] } } }],
    }

    const urls = enumeratePluginArtifacts("https://plugins.example.com/dist/mf-manifest.json", nested)

    expect(urls).toContain("https://plugins.example.com/dist/poc/remoteEntry.js")
    expect(urls).toContain("https://plugins.example.com/dist/chunks/a.js")
  })
})

describe("pin coverage over the enumerated set", () => {
  const urls = enumeratePluginArtifacts(entry, metadata)
  const pin = (letter: string) => `sha384-${letter.repeat(64)}`

  test("it names what goes in unchecked and which pins are dead declarations", () => {
    const result = previewFrontendPluginRecord(
      {
        id: "com.example.coverage3",
        entry,
        entryType: "module",
        integrity: {
          [entry]: pin("A"),
          "https://plugins.example.com/assets/gone-000000.js": pin("B"),
        },
      },
      { artifacts: urls },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected a preview")
    expect(result.preview.artifactsEnumerated).toBe(true)
    // 9 of the 10 URLs are unpinned even though the manifest declares two pins — the shape a distributor
    // needs to see, because "I pinned something" and "I pinned what loads" are different claims.
    expect(result.preview.unpinnedArtifacts).toHaveLength(9)
    expect(result.preview.unpinnedArtifacts).not.toContain(entry)
    expect(result.preview.pinsMatchingNothing).toEqual(["https://plugins.example.com/assets/gone-000000.js"])
  })

  test("complete coverage reports empty lists, and that is a different statement than not looking", () => {
    const all: Record<string, string> = {}
    for (const url of urls) all[url] = pin("C")

    const result = previewFrontendPluginRecord(
      { id: "com.example.coverage4", entry, entryType: "module", integrity: all },
      { artifacts: urls },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected a preview")
    expect(result.preview.unpinnedArtifacts).toEqual([])
    expect(result.preview.pinsMatchingNothing).toEqual([])
    expect(result.preview.artifactsEnumerated).toBe(true)
  })

  test("without enumeration the lists are silent rather than clean", () => {
    const result = previewFrontendPluginRecord(
      { id: "com.example.coverage5", entry, entryType: "module", integrity: { [entry]: pin("A") } },
      {},
    )

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected a preview")
    expect(result.preview.artifactsEnumerated).toBe(false)
    expect(result.preview.unpinnedArtifacts).toEqual([])
    expect(result.preview.pinsMatchingNothing).toEqual([])
  })
})
