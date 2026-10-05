import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, test } from "vitest"

import { buildCoverageReport, fillDigests, parseCliRequest } from "./plugin-integrity-report.js"

const BASE = "https://cdn.example/"
const metadataJson = readFileSync(
  resolve(import.meta.dirname, "../src/plugins/__fixtures__/mf-manifest.sample.json"),
  "utf8",
)
const manifestWith = (pins: Record<string, string>) => `
id = "com.example.tool"
version = "1.0.0"

[frontend]
runtime = "module-federation"
manifest = "mf-manifest.json"
entry_type = "module"
${Object.keys(pins).length === 0 ? "" : "[frontend.integrity]\n" + Object.entries(pins).map(([url, digest]) => `"${url}" = "${digest}"`).join("\n")}
`
const pin = (letter: string) => `sha384-${letter.repeat(64)}`

describe("parseCliRequest", () => {
  test("--coverage without --base is refused rather than guessed at", () => {
    const request = parseCliRequest(["--coverage", "m.toml", "mf-manifest.json"])

    expect(request.kind).toBe("error")
    if (request.kind !== "error") throw new Error("expected refusal")
    expect(request.message).toContain("--base")
  })

  test("plain URLs still take the digest path, and nothing still errors", () => {
    expect(parseCliRequest(["https://cdn.example/remoteEntry.js"])).toEqual({
      kind: "digest",
      urls: ["https://cdn.example/remoteEntry.js"],
    })
    expect(parseCliRequest([]).kind).toBe("error")
  })
})

describe("buildCoverageReport", () => {
  test("an unpinned build lists what goes in unchecked and what no pin can ever reach", () => {
    const result = buildCoverageReport({
      tomlText: manifestWith({}),
      metadataJson,
      base: `${BASE}mf-manifest.json`,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected a report")
    expect(result.report.entry).toBe(`${BASE}mf-manifest.json`)
    // The fixture's real shape: 12 artifacts, 10 of them fetched by the runtime itself.
    expect(result.report.artifactCount).toBe(12)
    expect(result.report.enforceableCount).toBe(10)
    expect(result.unpinned).toHaveLength(10)
    const text = result.report.lines.join("\n")
    // Two classes are named apart on purpose: one is fixed by adding pins, the other is not.
    expect(text).toContain("钉了也没用")
    expect(text).not.toContain("pin 已覆盖")
  })

  test("a pin for something the build never emits is reported as spinning", () => {
    const result = buildCoverageReport({
      tomlText: manifestWith({ "https://cdn.example/assets/gone-000000.js": pin("A") }),
      metadataJson,
      base: `${BASE}mf-manifest.json`,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected a report")
    expect(result.report.lines.join("\n")).toContain("空转pin\thttps://cdn.example/assets/gone-000000.js\tno-such-artifact")
  })

  test("pinning every reachable artifact says so, and still does not claim full coverage", () => {
    const empty = buildCoverageReport({ tomlText: manifestWith({}), metadataJson, base: `${BASE}mf-manifest.json` })
    if (!empty.ok) throw new Error("expected a report")
    const allPinned = buildCoverageReport({
      tomlText: manifestWith(Object.fromEntries(empty.unpinned.map((url) => [url, pin("C")]))),
      metadataJson,
      base: `${BASE}mf-manifest.json`,
    })

    expect(allPinned.ok).toBe(true)
    if (!allPinned.ok) throw new Error("expected a report")
    const text = allPinned.report.lines.join("\n")
    expect(text).toContain("pin 已覆盖 runtime 会取回的全部产物")
    // The honest half: covered everything the hook sees, and still names what it never sees.
    expect(text).toContain("钉了也没用")
    expect(allPinned.unpinned).toEqual([])
  })

  test("unparsable metadata is an issue, not a crash", () => {
    const result = buildCoverageReport({ tomlText: manifestWith({}), metadataJson: "{ nope", base: `${BASE}mf-manifest.json` })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected failure")
    expect(result.issues[0]?.field).toContain("mf-manifest.json")
  })
})

describe("fillDigests", () => {
  test("an unreachable origin still yields the coverage answer, with only the digest column missing", async () => {
    const built = buildCoverageReport({ tomlText: manifestWith({}), metadataJson, base: `${BASE}mf-manifest.json` })
    if (!built.ok) throw new Error("expected a report")

    const lines = await fillDigests(built.report, built.unpinned, async () => undefined)

    expect(lines.filter((line) => line.startsWith("没钉"))).toHaveLength(10)
    expect(lines.join("\n")).toContain("摘要未取")
    // The refusal is scoped to the digests; the counts above it are unaffected.
    expect(lines[1]).toContain("本次会抓 12 份")
  })

  test("reachable digests land in the pasteable column", async () => {
    const built = buildCoverageReport({ tomlText: manifestWith({}), metadataJson, base: `${BASE}mf-manifest.json` })
    if (!built.ok) throw new Error("expected a report")

    const lines = await fillDigests(built.report, built.unpinned, async () => pin("D"))

    expect(lines.some((line) => line === `没钉\t${built.report.entry}\t${pin("D")}`)).toBe(true)
    expect(lines.join("\n")).not.toContain("摘要未取")
  })
})
