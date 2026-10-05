// @vitest-environment happy-dom
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

import { frontendPluginForModule } from "./dynamicEntries"
import { XIRANITE_FRONTEND_API_VERSION } from "./frontendApi"
import {
  frontendPluginRecordFromManifest,
  installFrontendPluginFromManifestText,
  installFrontendPluginFromManifestUrl,
} from "./pluginManifestInstall"
import { discoverInstalledFrontendPlugins, uninstallFrontendPlugin } from "./pluginRegistry"

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
    expect(stored[0]!.contributions?.map((entry) => entry.id)).toEqual(["poc-frontend.entry"])
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
