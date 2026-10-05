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
  pathExists,
  saveXiraniteConfigText,
  updateNodeConfigFile,
  updateXiraniteConfig,
} from "@xiranite/config/node"

interface ProbeInput {
  action: "writeNode" | "load" | "merge" | "exists" | "escape"
  dir: string
  mode?: string
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
