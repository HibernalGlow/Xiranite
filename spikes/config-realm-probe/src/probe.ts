/**
 * The realm-side probe for `@xiranite/config/node`.
 *
 * Shape of a pure node (`crates/xiranite-quickjs-executor/src/node.rs:78`): `run(input)` returns the data
 * document and the harness wraps it. Everything the probe touches goes through the config module, so a pass
 * here means the realm reached the host's config service, took the lock, and replaced the document — the
 * exact path that failed with `no setter for property` before the move (§15.8).
 */
import {
  loadXiraniteConfig,
  updateAtomicJsonFile,
  pathExists,
  saveXiraniteConfigText,
  updateNodeConfigFile,
  updateXiraniteConfig,
} from "@xiranite/config/node"
import { join } from "node:path"

interface ProbeInput {
  action: "writeNode" | "load" | "merge" | "exists" | "escape"
  dir: string
  mode?: string
  /** Take the lock and return without committing, so the *other* runtime can be aimed at the leftover. */
  holdOnly?: boolean
  /** Number of host round-trips to spend inside the transaction, so the other runtime can observe the lock. */
  spin?: number
  /** The `[nodes.<section>]` to write, so several processes can be pointed at different sections. */
  section?: string
  extra?: string
  outside?: string
}

export async function run(input: ProbeInput): Promise<Record<string, unknown>> {
  const options = { dataDir: input.dir }

  if (input.action === "writeNode") {
    const result = await updateNodeConfigFile(input.section ?? "probe", { mode: input.mode ?? "scan" }, options)
    return { action: "writeNode", path: result.path, config: result.config }
  }

  if (input.action === "slowMerge") {
    // A transaction that stays open long enough for the *other* runtime to aim at it: the realm has no
    // timers, so the wait is real host round-trips rather than a sleep.
    const spins = input.spin ?? 4000
    const result = await updateXiraniteConfig(async (config) => {
      for (let index = 0; index < spins; index += 1) await pathExists(join(input.dir, "sentinel-absent"))
      return { ...config, nodes: { ...(config.nodes ?? {}), "probe-slow": { spins } } }
    }, options)
    return { action: "slowMerge", path: result.path, changed: result.changed, spins }
  }

  if (input.action === "holdOnly") {
    // `updateAtomicJsonFile` leaves the lock behind when the updater throws: the realm's lock file stays on
    // disk carrying the realm's token, which is the exact shape the other runtime has to recognise. The
    // process then exits, so it also doubles as the crash leftover the stale window exists for.
    const target = join(input.dir, "state.json")
    let captured: string | null = null
    try {
      await updateAtomicJsonFile(target, (current: { held?: boolean }) => {
        captured = JSON.stringify(current ?? {})
        throw new Error("probe: holding the lease")
      }, { fallback: { held: false } })
    } catch {
      /* expected: the throw is the point */
    }
    return { action: "holdOnly", target, before: captured }
  }

  if (input.action === "merge") {
    // Two different node sections written by two calls must both survive: that is the read-modify-write the
    // transport transaction body owns, above the lock.
    await updateNodeConfigFile("probe-a", { mode: "plan" }, options)
    const second = await updateNodeConfigFile("probe-b", { mode: "apply" }, options)
    const loaded = await loadXiraniteConfig(options)
    return { action: "merge", path: second.path, nodes: loaded.config.nodes }
  }

  if (input.action === "load") {
    const loaded = await loadXiraniteConfig(options)
    return { action: "load", path: loaded.path, config: loaded.config }
  }

  if (input.action === "exists") {
    const loaded = await loadXiraniteConfig(options)
    return { action: "exists", exists: await pathExists(loaded.path) }
  }

  // Negative control: a write aimed at a directory the operation was not granted. The host must refuse it.
  const escape = await saveXiraniteConfigText("app = { leaked = true }\n", { dataDir: input.outside ?? input.dir })
  return { action: "escape", writtenTo: escape }
}
