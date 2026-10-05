import { expect, test } from "vitest"

import { loadRemoteModule, registerFrontendPlugin } from "./frontendRuntime"

/**
 * §14 第 7 条: is there a `<script>`/`globalLoading` race when a remote is registered and loaded
 * immediately — which is exactly what startup activation does (`main.tsx` registers from the install
 * record, then the first render of that module id loads it, with no user interaction in between).
 *
 * The remote is a real ESM module federation entry (`__fixtures__/esm-remote-entry.js`, the
 * `get`/`init` shape the WKWebView probe measured), so this goes through the actual runtime:
 * register → snapshot → load.
 *
 * Four facts measured here, all of which shape how a plugin must be written:
 *   - `loadRemote("id/entry")` reaches the container as `get("./entry")` — the `./` prefix is part of
 *     the key, which is why §2.1 spells exposes as `module = "./FooPanel"`;
 *   - the container's `get` runs **once per `loadRemote` call**, even for the same expose, so a
 *     remote's `get` must be cheap and idempotent (real MF containers return a memoized factory);
 *   - what does not repeat is the expensive part: `init` runs once and the entry URL is fetched once
 *     — asserted from resource timings rather than inferred;
 *   - successive calls hand back freshly wrapped namespace objects, so `Object.is` between two loads
 *     is not a dedupe signal. Count at the container or at the network, not on the returned object.
 */
const REMOTE_URL = new URL("./__fixtures__/esm-remote-entry.js", import.meta.url).href
const PLUGIN_ID = "xf-cold-start"

interface FixtureNamespace {
  default: { marker: string; timesAskedForThisModule: number }
}

async function fixtureStats(): Promise<{ initCount: number; requested: string[] }> {
  const mod = (await import(/* @vite-ignore */ REMOTE_URL)) as { stats: () => { initCount: number; requested: string[] } }
  return mod.stats()
}

function entryFetchCount(): number {
  return performance.getEntriesByType("resource").filter((entry) => entry.name === REMOTE_URL).length
}

test("registering and loading in the same tick works, with one init and one entry fetch", async () => {
  registerFrontendPlugin({ id: PLUGIN_ID, entry: REMOTE_URL, entryType: "module" })

  const [first, second] = await Promise.all([
    loadRemoteModule<FixtureNamespace>(PLUGIN_ID, "entry"),
    loadRemoteModule<FixtureNamespace>(PLUGIN_ID, "entry"),
  ])

  expect(first.default.marker).toBe("fixture:./entry")
  expect(second.default.marker).toBe("fixture:./entry")

  const stats = await fixtureStats()
  expect(stats.requested).toEqual(["./entry", "./entry"])
  expect(stats.initCount).toBe(1)
  expect(entryFetchCount()).toBe(1)
})

test("a repeated load of the same expose does not re-download or re-init the remote", async () => {
  const again = await loadRemoteModule<FixtureNamespace>(PLUGIN_ID, "entry")
  expect(again.default.marker).toBe("fixture:./entry")

  const stats = await fixtureStats()
  expect(stats.requested).toEqual(["./entry", "./entry", "./entry"])
  expect(stats.initCount).toBe(1)
  expect(entryFetchCount()).toBe(1)
})

test("a different expose on the same remote reuses the loaded entry", async () => {
  const panel = await loadRemoteModule<FixtureNamespace>(PLUGIN_ID, "panel")
  expect(panel.default.marker).toBe("fixture:./panel")

  const stats = await fixtureStats()
  expect(stats.requested).toEqual(["./entry", "./entry", "./entry", "./panel"])
  expect(stats.initCount).toBe(1)
  expect(entryFetchCount()).toBe(1)
})
