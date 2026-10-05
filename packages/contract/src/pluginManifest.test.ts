import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, test } from "vitest"

import { FRONTEND_RUNTIME, isUsableSri, parseFrontendPluginManifest, type ManifestIssue } from "./pluginManifest.js"

/**
 * The `[frontend]` half of `manifest.toml` (§2.1). Errors come back as data, so every test asserts on
 * the issue list rather than catching a throw — an install dialog has to show all of it at once.
 */

const good = `
id = "com.example.good"
name = "Good"
version = "1.2.0"
frontend_api = "1.0"

[frontend]
runtime = "module-federation"
manifest = "dist/mf-manifest.json"
alias = "good"
entry_type = "module"
share_scope = "default"
required_api = "^1.0"

[[frontend.exposes]]
id = "good.panel"
module = "./Panel"
`

const PINNED_URL = "http://127.0.0.1:4176/remoteEntry.js"
const PIN = `sha384-${"A".repeat(64)}`

describe("parseFrontendPluginManifest", () => {
  test("reads the documented shape and resolves the entry against the manifest's own URL", () => {
    const result = parseFrontendPluginManifest(good, { baseUrl: "http://127.0.0.1:4176/manifest.toml" })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected the manifest to parse")
    expect(result.manifest.id).toBe("com.example.good")
    expect(result.manifest.name).toBe("Good")
    expect(result.manifest.version).toBe("1.2.0")
    expect(result.manifest.frontend.entry).toBe("http://127.0.0.1:4176/dist/mf-manifest.json")
    expect(result.manifest.frontend.entryType).toBe("module")
    expect(result.manifest.frontend.alias).toBe("good")
    expect(result.manifest.frontend.requiredApi).toBe("^1.0")
    expect(result.manifest.contributions).toEqual([
      { kind: "component", id: "good.panel", module: "./Panel" },
    ])
  })

  test("the repository's own example manifest parses with the same reader", () => {
    const path = resolve(import.meta.dirname, "../../../examples/plugins/frontend-only/manifest.toml")
    const result = parseFrontendPluginManifest(readFileSync(path, "utf8"), {
      baseUrl: "http://127.0.0.1:4173/",
      hostFrontendApiVersion: "1.0.0",
    })

    // The shipped file used `required_api = "1.0"`, which §2.1's own note says is not a range. If it
    // ever regresses, this test is what says so — with the reason, not a bare false.
    expect(result.ok ? [] : (result as { ok: false; issues: Array<{ field: string; message: string }> }).issues)
      .toEqual([])
    if (!result.ok) throw new Error("expected the shipped manifest to parse")
    expect(result.manifest.frontend.entry).toBe("http://127.0.0.1:4173/dist/mf-manifest.json")
    expect(result.manifest.frontend.requiredApi).toBe("^1.0")
  })

  test("a runtime this host cannot load is refused, not run as module-federation anyway", () => {
    const result = parseFrontendPluginManifest(good.replace(`runtime = "${FRONTEND_RUNTIME}"`, 'runtime = "systemjs"'), {
      baseUrl: "http://127.0.0.1:4173/",
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected refusal")
    expect(result.issues[0]!.field).toBe("frontend.runtime")
    expect(result.issues[0]!.message).toContain("module-federation")
  })

  test("a required_api the host cannot satisfy is refused with the reason", () => {
    const result = parseFrontendPluginManifest(good.replace('required_api = "^1.0"', 'required_api = "^9.0"'), {
      baseUrl: "http://127.0.0.1:4173/",
      hostFrontendApiVersion: "1.0.0",
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected refusal")
    expect(result.issues.map((issue: ManifestIssue) => issue.field)).toEqual(["frontend.required_api"])
    expect(result.issues[0]!.message).toContain("incompatible")
  })

  test("a bare major.minor is not a range, and the manifest reader says so", () => {
    const result = parseFrontendPluginManifest(good.replace('required_api = "^1.0"', 'required_api = "1.0"'), {
      baseUrl: "http://127.0.0.1:4173/",
      hostFrontendApiVersion: "1.0.0",
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected refusal")
    expect(result.issues[0]!.message).toContain("unsupported-range")
  })

  test("with no host version supplied the requirement is recorded, not judged", () => {
    const result = parseFrontendPluginManifest(good.replace('required_api = "^1.0"', 'required_api = "^9.0"'), {
      baseUrl: "http://127.0.0.1:4173/",
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected the CLI-style read to succeed")
    expect(result.manifest.frontend.requiredApi).toBe("^9.0")
  })

  test("a relative entry with no base URL is an error rather than a guess", () => {
    const result = parseFrontendPluginManifest(good, {})
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected refusal")
    expect(result.issues.map((issue: ManifestIssue) => issue.field)).toContain("frontend.manifest")
  })

  test("pins are validated as SRI, and only well-formed ones survive into the record", () => {
    expect(isUsableSri(PIN)).toBe(true)
    expect(isUsableSri(`sha384-${"A".repeat(60)}`)).toBe(false)
    expect(isUsableSri("sha999-abc")).toBe(false)

    const pinned = `${good}\n[frontend.integrity]\n"${PINNED_URL}" = "${PIN}"\n`
    const ok = parseFrontendPluginManifest(pinned, { baseUrl: "http://127.0.0.1:4173/" })
    expect(ok.ok).toBe(true)
    if (!ok.ok) throw new Error("expected pins to parse")
    expect(ok.manifest.frontend.integrity).toEqual({ [PINNED_URL]: PIN })

    const truncated = `${good}\n[frontend.integrity]\n"${PINNED_URL}" = "sha384-${"A".repeat(60)}"\n`
    const bad = parseFrontendPluginManifest(truncated, { baseUrl: "http://127.0.0.1:4173/" })
    expect(bad.ok).toBe(false)
    if (bad.ok) throw new Error("expected a truncated pin to be refused")
    expect(bad.issues[0]!.message).toContain("sha384")
  })

  test("contribution kinds are closed, and route is refused because nothing consumes it", () => {
    const result = parseFrontendPluginManifest(
      `${good}\n[[contributions]]\ntype = "route"\nid = "good.page"\n`,
      { baseUrl: "http://127.0.0.1:4173/" },
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected the route kind to be refused")
    expect(result.issues[0]!.field).toBe("contributions[0].type")
    expect(result.issues[0]!.message).toContain("has no reader")
  })

  test("the same id contributed through both spellings is refused, not silently merged", () => {
    const result = parseFrontendPluginManifest(
      `${good}\n[[contributions]]\nkind = "component"\nid = "good.panel"\nmodule = "./Other"\n`,
      { baseUrl: "http://127.0.0.1:4173/" },
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected the duplicate to be refused")
    expect(result.issues.map((issue: ManifestIssue) => issue.field)).toEqual(["contributions.good.panel"])
  })

  test("every problem is reported in one pass", () => {
    const broken = `
id = ""
[frontend]
runtime = "webpack"
manifest = ""
entry_type = "script"
source_allow_list = ["not-a-url"]
`
    const result = parseFrontendPluginManifest(broken, {})
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected refusal")
    expect(result.issues.map((issue: ManifestIssue) => issue.field).sort()).toEqual(
      ["frontend.entry_type", "frontend.manifest", "frontend.runtime", "frontend.source_allow_list", "id"].sort(),
    )
  })

  test("unreadable TOML is one data issue, not a throw", () => {
    const result = parseFrontendPluginManifest("id = ", {})
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected refusal")
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]!.field).toBe("manifest")
    expect(result.issues[0]!.message).toContain("not readable TOML")
  })

  test("[permissions] is kept verbatim because nothing reads it yet", () => {
    const result = parseFrontendPluginManifest(good, { baseUrl: "http://127.0.0.1:4173/" })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected parse")
    expect(result.manifest.permissions).toBeUndefined()

    const withPerms = parseFrontendPluginManifest(`${good}\n[permissions]\nclipboard = false\n`, {
      baseUrl: "http://127.0.0.1:4173/",
    })
    expect(withPerms.ok).toBe(true)
    if (!withPerms.ok) throw new Error("expected parse")
    expect(withPerms.manifest.permissions).toEqual({ clipboard: false })
  })
})
