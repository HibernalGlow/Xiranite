/**
 * `@xiranite/config/node`, as the QuickJS realm sees it.
 *
 * The real module is the Node/Bun transport (`packages/config/src/node.ts`): it locks with
 * `fs.open(path, "wx")` and replaces through a `FileHandle`. Neither exists inside the realm — `open` is
 * published as unimplemented in `surface.ts` because "a FileHandle is a descriptor the realm cannot own",
 * and a cross-process lock implemented by sandboxed JS would have no witness anybody else could check
 * anyway. So this module keeps the **same export names and shapes** and swaps how the answer arrives: every
 * primitive is a `service.invoke { service: "config" }` call, answered by
 * `crates/xiranite-core/src/config_store.rs`.
 *
 * ## What is *not* duplicated here
 *
 * The transaction bodies — read under the lock, validate with zod, merge the patch, serialize, compare,
 * commit — are the shared ones in `packages/config/src/transport.ts`, reached through the package's pure
 * root entry (`@xiranite/config`, which imports nothing but `node:path`, `zod` and `smol-toml`). This file
 * only names the seven primitives in host terms. That is what keeps one implementation of config semantics
 * while the lock has exactly one implementation, in the host.
 *
 * ## Why the calls are async
 *
 * Acquisition waits on the host's own backoff budget, and `hostCallAsync` is the form that keeps the realm's
 * event loop able to pump while the host waits — the same reason the czkawka scan loop long-polls instead of
 * spinning (`czkawka-service.ts`).
 */
import { createConfigIo, type ConfigTransport } from "@xiranite/config"

import { opServiceInvokeAsync } from "./ops.ts"

const SERVICE = "config"

/** The lock sibling's suffix, kept identical to the Node transport and the Rust store. */
export const XIRANITE_CONFIG_LOCK_SUFFIX = ".xr-write.lock"

interface ReadAnswer {
  contents: string | null
}

interface BeginAnswer {
  token: string
  resolvedPath: string
  contents: string | null
}

interface ExistsAnswer {
  exists: boolean
}

interface HeldAnswer {
  held: boolean
}

/** The realm's transport: every primitive is one host service call, and nothing else. */
export const hostConfigTransport: ConfigTransport = {
  async read(path) {
    const answer = await opServiceInvokeAsync<ReadAnswer>(SERVICE, "read", { path })
    return answer.contents
  },

  async exists(path) {
    const answer = await opServiceInvokeAsync<ExistsAnswer>(SERVICE, "exists", { path })
    return answer.exists
  },

  async writeAtomic(path, contents) {
    await opServiceInvokeAsync<null>(SERVICE, "writeAtomic", { path, contents })
  },

  async begin(path) {
    const answer = await opServiceInvokeAsync<BeginAnswer>(SERVICE, "beginUpdate", { path })
    return { token: answer.token, contents: answer.contents }
  },

  async commit(path, token, contents) {
    await opServiceInvokeAsync<null>(SERVICE, "commitUpdate", { path, token, contents })
  },

  async abort(path, token) {
    await opServiceInvokeAsync<null>(SERVICE, "abortUpdate", { path, token })
  },

  async held(path, token) {
    const answer = await opServiceInvokeAsync<HeldAnswer>(SERVICE, "held", { path, token })
    return answer.held
  },
}

const io = createConfigIo(hostConfigTransport)

export const loadXiraniteConfig = io.loadXiraniteConfig
export const saveXiraniteConfig = io.saveXiraniteConfig
export const saveXiraniteConfigText = io.saveXiraniteConfigText
export const updateXiraniteConfig = io.updateXiraniteConfig
export const updateNodeConfigFile = io.updateNodeConfigFile
export const readAtomicJsonFile = io.readAtomicJsonFile
export const withXiraniteFileLock = io.withXiraniteFileLock
export const updateAtomicJsonFile = io.updateAtomicJsonFile
export const resolveNodeConfig = io.resolveNodeConfig
export const loadNodeConfigWithHints = io.loadNodeConfigWithHints
export const pathExists = io.pathExists
