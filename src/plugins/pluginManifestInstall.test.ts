// @vitest-environment happy-dom
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

import { frontendPluginForModule, resolveEntryLoader } from "./dynamicEntries"
import { XIRANITE_FRONTEND_API_VERSION } from "./frontendApi"
import {
  checkFrontendPluginUpdate,
  frontendPluginRecordFromManifest,
  installFrontendPluginFromManifestText,
  installFrontendPluginFromManifestUrl,
} from "./pluginManifestInstall"
import { discoverInstalledFrontendPlugins, uninstallFrontendPlugin, type InstalledFrontendPlugin } from "./pluginRegistry"
import type { ParsedPluginManifest } from "@xiranite/contract"

const STORAGE_KEY = "xiranite.frontendPlugins"

const manifestFor = (overrides = "") => `
id = "com.example.frommanifest"
version = "2.1.0"

[frontend]
runtime = "module-federation"
manifest = "https://plugins.example.com/mf-manifest.json"
required_api = "^1.0"
${overrides}
[[frontend.exposes]]
id = "frommanifest.panel"
module = "./Panel"
`

const cleanup = () => {
  uninstallFrontendPlugin("com.example.frommanifest")
  uninstallFrontendPlugin("poc-frontend")
  globalThis.localStorage.removeItem(STORAGE_KEY)
}

beforeEach(cleanup)
afterEach(cleanup)

/**
 * Every field `[frontend]` can produce must either land in the install record or be listed here with
 * the reason it cannot. Without this list, "the parser accepts it" quietly becomes "the host uses it",
 * which is how `share_scope` sat unread for a round and how `allowed_paths` survived on the retired
 * backend as a documented-but-dead field.
 */
const DECLARED_BUT_NOT_CARRIED: Record<string, string> = {
  frontendApi: "the host's own published frontend API version governs; this is the plugin's self-description",
  permissions: "§6's grant layer is the host's ceiling (plus the future grant UI), not the manifest's",
}

/**
 * The leaf fields a manifest produced, minus the containers that have no single record counterpart.
 * `frontend` and `permissions` are structural (the first is spread into the record's own fields, the
 * second is allowlisted), and `contributions` is carried as a list.
 */
const MANIFEST_CONTAINERS = new Set(["frontend", "permissions", "contributions"])

function missingManifestFields(
  manifest: ParsedPluginManifest,
  record: InstalledFrontendPlugin,
): string[] {
  const carried = new Set(
    Object.keys(record).filter((key) => record[key as keyof InstalledFrontendPlugin] !== undefined),
  )
  const produced = new Set<string>([
    ...Object.keys(manifest.frontend).filter(
      (key) => (manifest.frontend as unknown as Record<string, unknown>)[key] !== undefined,
    ),
    ...Object.keys(manifest).filter(
      (key) =>
        !MANIFEST_CONTAINERS.has(key)
        && (manifest as unknown as Record<string, unknown>)[key] !== undefined,
    ),
  ])
  if (manifest.contributions?.some((entry: { kind: string }) => entry.kind === "component")) carried.add("contributions")
  return [...produced].filter((key) => !carried.has(key) && !(key in DECLARED_BUT_NOT_CARRIED))
}

/**
 * The per-row leaves, because a container reaching the record proves nothing about the fields inside it.
 *
 * This is the exact hole that let `module` be dropped for a round while the guard above stayed green:
 * the list arrived, so "contributions is carried" was satisfied even though every row's expose path
 * had been thrown away between the parser and the record (`contributions.ts` had no such field).
 */
function missingContributionFields(
  manifest: ParsedPluginManifest,
  record: InstalledFrontendPlugin,
): string[] {
  const rows = new Map((record.contributions ?? []).map((row) => [row.id, row as unknown as Record<string, unknown>]))
  const missing: string[] = []
  for (const entry of manifest.contributions ?? []) {
    // Only `component` rows are honoured today; the rest are refused or reported as notes, so their
    // leaves are not expected in the record.
    if (entry.kind !== "component") continue
    const source = entry as unknown as Record<string, unknown>
    const row = rows.get(entry.id)
    if (!row) {
      missing.push(`${entry.id}: (没有到达记录的贡献行)`)
      continue
    }
    for (const key of Object.keys(source).filter((k) => source[k] !== undefined)) {
      if (row[key] === undefined) missing.push(`${entry.id}.${key}`)
    }
  }
  return missing
}

describe("no manifest field disappears silently", () => {
  test("a maximal manifest reaches the record or appears in the allowlist", () => {
    const maximal = `
id = "com.example.maximal"
name = "Maximal"
description = "every field"
version = "3.4.5"
frontend_api = "1.0"

[frontend]
runtime = "module-federation"
manifest = "https://plugins.example.com/mf-manifest.json"
alias = "maximal_widget"
entry_type = "var"
share_scope = "xr-scope"
required_api = "^1.0"
source_allow_list = ["https://plugins.example.com"]

[frontend.integrity]
"https://plugins.example.com/remoteEntry.js" = "sha384-${"A".repeat(64)}"

[[frontend.exposes]]
id = "maximal.panel"
module = "./Panel"
`
    const result = installFrontendPluginFromManifestText(maximal, { baseUrl: "https://plugins.example.com/manifest.toml" })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(`expected install, got ${JSON.stringify(result.issues)}`)

    const record = discoverInstalledFrontendPlugins().plugins[0]!
    const missing = missingManifestFields(result.manifest, record)
    expect(missing).toEqual([])
    expect(missingContributionFields(result.manifest, record)).toEqual([])

    // And the ones the record does carry hold the manifest's values, not the parser's defaults.
    expect(record.name).toBe("Maximal")
    expect(record.description).toBe("every field")
    expect(record.shareScope).toBe("xr-scope")
    expect(record.alias).toBe("maximal_widget")
    expect(record.entryType).toBe("var")
    expect(record.allowedOrigins).toEqual(["https://plugins.example.com"])
    expect(Object.keys(record.integrity ?? {})).toEqual(["https://plugins.example.com/remoteEntry.js"])
  })

  test("the comparison fires when a field is dropped on the way in", () => {
    // Positive control: a record that lost shareScope must be reported by the very same function.
    const maximal = `
id = "com.example.control"

[frontend]
runtime = "module-federation"
manifest = "https://plugins.example.com/mf-manifest.json"
share_scope = "xr-scope"
`
    const result = installFrontendPluginFromManifestText(maximal, { baseUrl: "https://plugins.example.com/" })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected install")
    const record = discoverInstalledFrontendPlugins().plugins[0]!
    const stripped = { ...record, shareScope: undefined } as unknown as InstalledFrontendPlugin
    expect(missingManifestFields(result.manifest, stripped)).toEqual(["shareScope"])
  })
})

describe("installFrontendPluginFromManifestText", () => {
  test("the repository's shipped example manifest installs through the real path", () => {
    const text = readFileSync(resolve(import.meta.dirname, "../../examples/plugins/frontend-only/manifest.toml"), "utf8")
    const result = installFrontendPluginFromManifestText(text, { baseUrl: "http://127.0.0.1:4173/" })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(`expected install, got ${JSON.stringify(result.issues)}`)
    expect(result.install.ok).toBe(true)

    const stored = discoverInstalledFrontendPlugins().plugins
    expect(stored).toHaveLength(1)
    // `alias` keys the remote in the MF runtime (§2.1); moduleId stays the plugin id. Conflating them
    // is what made the live probe fail to load, so the two are asserted apart on purpose.
    expect(stored[0]!.id).toBe("poc-frontend")
    expect(stored[0]!.moduleId).toBe("poc-frontend")
    expect(stored[0]!.alias).toBe("poc_frontend")
    expect(stored[0]!.entry).toBe("http://127.0.0.1:4173/mf-manifest.json")
    expect(stored[0]!.version).toBe("0.1.0")
    expect(stored[0]!.requiredApi).toBe("^1.0")
    expect(stored[0]!.contributions?.map((entry) => entry.id)).toEqual(["poc-frontend.entry", "poc-frontend.panel"])
    // Each row keeps its own expose all the way into the record. The chain this pins is
    // TOML → record → contribution → loader, which is exactly the stretch where `module` used to be
    // parsed by the contract reader and then dropped (`docs/plugin-architecture.md` §2.1's 2026-10-05 note).
    expect(stored[0]!.contributions?.map((entry) => entry.module)).toEqual(["./entry", "./Panel"])
    // The second contributed id is served by this plugin: not merely listed, but loadable, and it
    // resolves to the plugin (so `ModuleRenderer` gives it the projection rather than the full host).
    expect(resolveEntryLoader("poc-frontend.panel")).toBeDefined()
    expect(frontendPluginForModule("poc-frontend.panel")?.alias).toBe("poc_frontend")
    expect(resolveEntryLoader("poc-frontend.nobody")).toBeUndefined()
    expect(frontendPluginForModule("poc-frontend")?.entry).toBe("http://127.0.0.1:4173/mf-manifest.json")
  })

  test("an alias is carried to the record so the runtime keys the remote by it", () => {
    const result = installFrontendPluginFromManifestText(
      manifestFor('alias = "frommanifest_widget"\n'),
      { baseUrl: "http://127.0.0.1:4173/" },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected install")
    const stored = discoverInstalledFrontendPlugins().plugins[0]!
    expect(stored.alias).toBe("frommanifest_widget")
    expect(stored.moduleId).toBe("com.example.frommanifest")
  })

  test("a manifest asking for more than the host's frontend API is refused before registering", () => {
    const result = installFrontendPluginFromManifestText(
      manifestFor().replace('required_api = "^1.0"', 'required_api = "^9.0"'),
      { baseUrl: "http://127.0.0.1:4173/" },
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected refusal")
    expect(result.issues[0]!.field).toBe("frontend.required_api")
    expect(result.issues[0]!.message).toContain(XIRANITE_FRONTEND_API_VERSION)
    expect(discoverInstalledFrontendPlugins().plugins).toEqual([])
  })

  test("a manifest naming a runtime this host cannot load is refused", () => {
    const result = installFrontendPluginFromManifestText(
      manifestFor().replace('runtime = "module-federation"', 'runtime = "systemjs"'),
      { baseUrl: "http://127.0.0.1:4173/" },
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected refusal")
    expect(result.issues[0]!.field).toBe("frontend.runtime")
  })

  test("grants and trust are never taken from the manifest", () => {
    const result = installFrontendPluginFromManifestText(manifestFor(), { baseUrl: "http://127.0.0.1:4173/" })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected install")

    // The record carries no capabilities and no trust ⇒ default-deny projection still applies.
    const stored = discoverInstalledFrontendPlugins().plugins[0]!
    expect(stored.capabilities).toBeUndefined()
    expect(stored.trust).toBeUndefined()
    expect(frontendPluginForModule("com.example.frommanifest")?.entry).toBe("https://plugins.example.com/mf-manifest.json")
  })
})

describe("frontendPluginRecordFromManifest", () => {
  test("sections nothing reads come back as notes, and only the component row becomes a module", () => {
    const text = `${manifestFor()}
[[contributions]]
type = "tray"
id = "frommanifest.tray"

[permissions]
clipboard = false
`
    const result = installFrontendPluginFromManifestText(text, { baseUrl: "http://127.0.0.1:4173/" })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected install")
    const stored = discoverInstalledFrontendPlugins().plugins[0]!
    expect(stored.contributions?.map((entry) => entry.kind)).toEqual(["component"])
    // Data, not a console line: the install surface is where a human has to see this.
    expect(result.notes).toHaveLength(2)
    expect(result.notes.join(" ")).toContain("tray contribution")
    expect(result.notes.join(" ")).toContain("[permissions]")
  })

  test("share_scope reaches the record instead of being dropped on the way in", () => {
    const result = installFrontendPluginFromManifestText(manifestFor('share_scope = "xr-plugin-scope"\n'), {
      baseUrl: "http://127.0.0.1:4173/",
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected install")
    const stored = discoverInstalledFrontendPlugins().plugins[0]!
    expect(stored.shareScope).toBe("xr-plugin-scope")
  })
})

describe("installFrontendPluginFromManifestUrl", () => {
  test("an unreachable manifest answers with data, not a throw", async () => {
    vi.stubGlobal("fetch", async () => { throw new Error("offline") })
    try {
      const result = await installFrontendPluginFromManifestUrl("https://plugins.example.com/manifest.toml")
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error("expected failure")
      expect(result.issues[0]!.field).toBe("manifestUrl")
      expect(result.issues[0]!.message).toContain("offline")
    } finally {
      vi.unstubAllGlobals()
    }
  })

  test("a non-2xx answer reports the status", async () => {
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 404, statusText: "Not Found" }))
    try {
      const result = await installFrontendPluginFromManifestUrl("https://plugins.example.com/manifest.toml")
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error("expected failure")
      expect(result.issues[0]!.message).toContain("404")
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe("the record mapping itself", () => {
  test("moduleId falls back to the plugin id when the manifest declares no alias", () => {
    const result = installFrontendPluginFromManifestText(manifestFor(), { baseUrl: "http://127.0.0.1:4173/" })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected install")
    const mapped = frontendPluginRecordFromManifest(result.manifest)
    expect(mapped.ok).toBe(true)
    if (!mapped.ok) throw new Error("expected mapping")
    expect(mapped.record.moduleId).toBe("com.example.frommanifest")
  })
})

const manifestWithVersion = (version: string) => `
id = "com.example.updatecheck"
version = "${version}"

[frontend]
runtime = "module-federation"
manifest = "https://plugins.example.com/mf-manifest.json"
`

describe("checkFrontendPluginUpdate", () => {
  const id = "com.example.updatecheck"

  const installFrom = (version: string) => installFrontendPluginFromManifestText(manifestWithVersion(version), {
    baseUrl: "https://plugins.example.com/manifest.toml",
    manifestUrl: "https://plugins.example.com/manifest.toml",
  })

  test("a differing declared version is reported as changed, without touching the record", async () => {
    expect(installFrom("1.0.0").ok).toBe(true)
    const before = globalThis.localStorage.getItem(STORAGE_KEY)
    vi.stubGlobal("fetch", async () => new Response(manifestWithVersion("1.1.0"), { status: 200 }))
    try {
      const result = await checkFrontendPluginUpdate(id)
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error("expected a check")
      expect(result.check).toEqual({
        pluginId: id,
        current: "1.0.0",
        available: "1.1.0",
        changed: true,
        source: "https://plugins.example.com/manifest.toml",
        // The same declared entry, so applying this would keep the approval — pinned in the exact-shape
        // assertion so the field cannot silently disappear from the report.
        grantEffect: "kept",
      })
      // A check reads; it must not install. Ordering is the human's call until §5's range library lands.
      expect(globalThis.localStorage.getItem(STORAGE_KEY)).toBe(before)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  test("a release that moves the load source is reported as revoking the approval", async () => {
    // §2.4's lifetime rule made visible *before* someone installs: the approval is about this entry, so
    // an update pointing somewhere else starts back at `contract`. The check itself stays read-only.
    expect(installFrom("1.0.0").ok).toBe(true)
    const before = globalThis.localStorage.getItem(STORAGE_KEY)
    const moved = manifestWithVersion("2.0.0").replace(
      "https://plugins.example.com/mf-manifest.json",
      "https://cdn.example.org/poc/mf-manifest.json",
    )
    vi.stubGlobal("fetch", async () => new Response(moved, { status: 200 }))
    try {
      const result = await checkFrontendPluginUpdate(id)
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error("expected a check")
      expect(result.check.grantEffect).toBe("revoked-source-moved")
      expect(result.check.entryMoved).toEqual({
        from: "https://plugins.example.com/mf-manifest.json",
        to: "https://cdn.example.org/poc/mf-manifest.json",
      })
      expect(globalThis.localStorage.getItem(STORAGE_KEY)).toBe(before)

      // And it must not be the *version* difference doing that work: same source, new version stays kept.
      const sameSource = manifestWithVersion("2.0.0")
      vi.stubGlobal("fetch", async () => new Response(sameSource, { status: 200 }))
      const again = await checkFrontendPluginUpdate(id)
      expect(again.ok && again.check.grantEffect).toBe("kept")
      expect(again.ok && again.check.changed).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  test("the same version is not reported as an update", async () => {
    installFrom("1.0.0")
    vi.stubGlobal("fetch", async () => new Response(manifestWithVersion("1.0.0"), { status: 200 }))
    try {
      const result = await checkFrontendPluginUpdate(id)
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error("expected a check")
      expect(result.check.changed).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  test("a record without a manifest source says so instead of guessing from the entry URL", async () => {
    expect(installFrontendPluginFromManifestText(manifestWithVersion("1.0.0"), {
      baseUrl: "https://plugins.example.com/manifest.toml",
    }).ok).toBe(true)
    const result = await checkFrontendPluginUpdate(id)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected refusal")
    expect(result.issues[0]!.field).toBe("manifestUrl")
    expect(result.issues[0]!.message).toContain("without a manifest.toml")
  })

  test("an unreachable or unparseable source comes back as data", async () => {
    installFrom("1.0.0")
    vi.stubGlobal("fetch", async () => new Response("id = ", { status: 200 }))
    try {
      const result = await checkFrontendPluginUpdate(id)
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error("expected failure")
      expect(result.issues[0]!.field).toBe("manifestUrl.manifest")
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe("the contribution leaf guard can fire", () => {
  test("a declared expose path that never reaches the row is named", () => {
    // Control for the control: the container-only guard stayed green while this exact shape was live,
    // so the leaf check has to be able to say `x.panel.module` on its own.
    const manifest = {
      contributions: [{ kind: "component", id: "x.panel", module: "./X" }],
    } as unknown as ParsedPluginManifest
    const record = {
      contributions: [{ kind: "component", id: "x.panel" }],
    } as unknown as InstalledFrontendPlugin

    expect(missingContributionFields(manifest, record)).toEqual(["x.panel.module"])
  })

  test("a non-component row is not demanded of the record", () => {
    const manifest = {
      contributions: [{ kind: "tray", id: "x.tray", module: "./T" }],
    } as unknown as ParsedPluginManifest

    expect(missingContributionFields(manifest, { contributions: [] } as unknown as InstalledFrontendPlugin)).toEqual([])
  })
})
