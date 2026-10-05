import { expect, test } from "vitest"

import { loadRemoteModule } from "./frontendRuntime"
import { installFrontendPlugin, updateFrontendPlugin } from "./pluginRegistry"

/**
 * The one claim `docs/plugin-architecture.md` §14 refused to take on faith: does an `update` that
 * changes `entry` actually load the **new** bytes, or does the runtime keep the container it already
 * resolved for that remote name?
 *
 * `registerFrontendPlugin` passes `force: true` to `registerRemotes`, and MF logs
 * `The remote "…" is already registered` on every update — which reads like a warning about a
 * conflict and is in fact the replacement happening. Neither of those is evidence about the loaded
 * module, so the assertion is made where it matters: the marker the plugin component actually
 * receives has to come from the second fixture's file.
 *
 * This is self-falsifying in the direction that matters: if the runtime's per-name module cache won,
 * `second` would still say `fixture:./entry` and the B URL would show zero fetches.
 */
const URL_A = new URL("./__fixtures__/esm-remote-entry.js", import.meta.url).href
const URL_B = new URL("./__fixtures__/esm-remote-entry-b.js", import.meta.url).href
const PLUGIN_ID = "xf-source-swap"

interface FixtureNamespace {
  default: { marker: string }
}

function fetchCount(url: string): number {
  return performance.getEntriesByType("resource").filter((entry) => entry.name === url).length
}

/**
 * The container's own call log, read through a direct import of the same URL.
 *
 * This is the gauge that works here. `fetchCount` returned **0 for a URL that demonstrably loaded**
 * (asserted first, then measured on 2026-10-05): browser-mode pages pull hundreds of dev-server
 * modules before this file runs, the resource-timing buffer is finite, and the overflow drops the
 * oldest entries — so "no timing entry" is not "no fetch". Count at the container instead: a direct
 * `import()` of the same URL hands back the same ESM instance MF already evaluated, and the fixture
 * counts its own `init`/`get` calls.
 */
async function fixtureStats(url: string): Promise<{ initCount: number; requested: string[] }> {
  const mod = (await import(/* @vite-ignore */ url)) as {
    stats: () => { initCount: number; requested: string[] }
  }
  return mod.stats()
}

test("an update that changes the entry URL serves the new source, not the one already loaded", async () => {
  const installed = installFrontendPlugin({
    id: PLUGIN_ID,
    entry: URL_A,
    entryType: "module",
    moduleId: PLUGIN_ID,
    version: "1.0.0",
  })
  expect(installed.ok).toBe(true)

  const first = await loadRemoteModule<FixtureNamespace>(PLUGIN_ID, "entry")
  expect(first.default.marker).toBe("fixture:./entry")

  const updated = updateFrontendPlugin({
    id: PLUGIN_ID,
    entry: URL_B,
    entryType: "module",
    moduleId: PLUGIN_ID,
    version: "1.1.0",
  })
  expect(updated.ok).toBe(true)
  if (!updated.ok) throw new Error("expected the update to apply")
  expect(updated.replaced).toEqual({ version: "1.0.0", enabled: true })

  const second = await loadRemoteModule<FixtureNamespace>(PLUGIN_ID, "entry")
  expect(second.default.marker).toBe("fixture-b:./entry")

  // Counted at the containers: A was asked for exactly one expose (the load before the update) and
  // nothing after it, B was initialized once and served the load after the update.
  const statsA = await fixtureStats(URL_A)
  const statsB = await fixtureStats(URL_B)
  expect(statsA.requested).toEqual(["./entry"])
  expect(statsB.requested).toEqual(["./entry"])
  expect(statsB.initCount).toBe(1)

  // `fetchCount` is deliberately left unused by an assertion: the value it measured here was 0 for a
  // URL that provably loaded, and pinning that artifact to 0 would make the suite red for the wrong
  // reason the next time the page loads fewer modules.
})
