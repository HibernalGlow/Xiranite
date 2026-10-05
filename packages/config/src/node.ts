/**
 * The Node/Bun half of `@xiranite/config`: the transport, plus the IO surface built from the shared
 * transaction bodies in `transport.ts`.
 *
 * ## Why this file no longer uses `proper-lockfile` or `write-file-atomic`
 *
 * Both worked, and both came with machinery the realm cannot load. `graceful-fs` (pulled in by
 * `proper-lockfile`) opens by assigning properties onto the `fs` module, and the realm's `fs` shim has no
 * writable properties, so any bundle that reached the write path died at load with `no setter for property`
 * (measured on `linku`; `docs/migration/quickjs-substrate-evaluation.md` §15.8). `write-file-atomic` drags
 * `worker_threads`, and the two together put ~455 KB of lock implementation into every platform bundle that
 * imported anything from this module — including the five nodes that only needed a path string.
 *
 * Replacing them is not a preference for fewer dependencies: one of the two runtimes could not run the
 * dependency at all, and a lock is only worth having if both runtimes are looking at the same one. So the
 * protocol is stated once, on disk, and each side implements those primitives:
 *
 * - the lock is `<target>.xr-write.lock`, created exclusively (`O_EXCL`), containing the holder's token;
 *   a caller may write only while that file still carries its own token;
 * - a lock older than `LOCK_STALE_MS` belongs to a process that is gone and is broken;
 * - a document is replaced through a same-directory temp file, synced, then renamed.
 *
 * `crates/xiranite-core/src/config_store.rs` is the other half of that sentence. `transport.test.ts` pins
 * the two constant sets so they cannot drift silently.
 */
import { access, mkdir, open, readFile, realpath, rename, rm, stat } from "node:fs/promises"
import { basename, dirname, join } from "node:path"

import type { ConfigTransport } from "./transport.js"
import { createConfigIo } from "./transport.js"

export const XIRANITE_CONFIG_LOCK_SUFFIX = ".xr-write.lock"

/** The lock's crash-recovery window. Mirrors `DEFAULT_STALE_MS` in `config_store.rs`. */
const LOCK_STALE_MS = 30_000

/** Acquisition waits. Mirror `DEFAULT_RETRIES` and the 20/250 ms backoff of Rust `LockPolicy::default()`. */
const DEFAULT_LOCK_RETRIES = 50
const LOCK_MIN_DELAY_MS = 20
const LOCK_MAX_DELAY_MS = 250
const LOCK_BACKOFF_FACTOR = 1.2

/** Ceiling for one document, mirroring `MAX_TEXT_BYTES` so both halves refuse the same oversized write. */
const MAX_TEXT_BYTES = 4 * 1024 * 1024

/** Prefix of the temp document an atomic replace writes before renaming it over the target. */
const TEMP_PREFIX = ".xiranite-tmp-"

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

const lockPathOf = (target: string): string => `${target}${XIRANITE_CONFIG_LOCK_SUFFIX}`

/** A token unique within and across processes: pid plus a counter — the shape the Rust store writes too. */
let sequence = 0
function nextToken(): string {
  sequence += 1
  return `${process.pid}-${sequence}`
}

/** The wait before round `attempt`, floored and capped the way `LockPolicy::delay_ms` does. */
function delayMs(attempt: number): number {
  const grown = LOCK_MIN_DELAY_MS * LOCK_BACKOFF_FACTOR ** attempt
  return Math.min(Math.max(Math.round(grown), LOCK_MIN_DELAY_MS), LOCK_MAX_DELAY_MS)
}

async function readOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8")
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOENT" || code === "ENOTDIR") return null
    throw error
  }
}

/**
 * The canonical path to lock and replace.
 *
 * A symlinked config path would otherwise get its lock sibling next to the link while the bytes landed in
 * the target's real directory, so the link is resolved first — the `realpath` step this module did through
 * `canonicalWritablePath` before the transport existed.
 */
async function canonicalWritablePath(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== "ENOENT" && code !== "ENOTDIR") throw error
  }

  try {
    return join(await realpath(dirname(path)), basename(path))
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== "ENOENT" && code !== "ENOTDIR") throw error
    return path
  }
}

/**
 * Creates the lock sibling exclusively.
 *
 * Waits count against `retries`; breaking a stale leftover does not, so a caller with `retries: 0` still
 * recovers from a crashed holder — the same rule `ConfigStore::acquire` states.
 */
async function acquireLock(target: string, token: string, retries: number): Promise<void> {
  if (!Number.isSafeInteger(retries) || retries < 0 || retries > 100) {
    throw new RangeError("Xiranite config lockRetries must be an integer between 0 and 100.")
  }
  const lock = lockPathOf(target)
  await mkdir(dirname(target), { recursive: true })
  let waits = 0
  for (;;) {
    const created = await tryCreateLock(lock, token)
    if (created === "held") return
    if (created === "failed") {
      throw new Error(`Xiranite config lock could not be created: ${lock}`)
    }
    if (await isStale(lock)) {
      await rm(lock, { force: true })
      continue
    }
    if (waits >= retries) {
      throw new Error(`Timed out waiting for the Xiranite config writer: ${target}`, {
        cause: Object.assign(new Error("ELOCKED"), { code: "ELOCKED" }),
      })
    }
    await sleep(delayMs(waits))
    waits += 1
  }
}

type LockAttempt = "held" | "busy" | "failed"

async function tryCreateLock(lock: string, token: string): Promise<LockAttempt> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(lock, "wx")
    await handle.writeFile(token, "utf8")
    // The sync is the crash-safety half: a lock the OS had not written down is a lock a second process may
    // also have created.
    await handle.sync()
    return "held"
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return code === "EEXIST" ? "busy" : "failed"
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

async function isStale(lock: string): Promise<boolean> {
  let mtimeMs: number
  try {
    mtimeMs = (await stat(lock)).mtimeMs
  } catch {
    // A lock whose time cannot be read is treated as live: the alternative is deleting a running writer's
    // lock on the strength of a failed stat.
    return false
  }
  return Date.now() - mtimeMs >= LOCK_STALE_MS
}

async function holderOf(target: string): Promise<string | null> {
  return await readOrNull(lockPathOf(target))
}

async function releaseLock(target: string, token: string): Promise<void> {
  if ((await holderOf(target)) === token) {
    await rm(lockPathOf(target), { force: true })
  }
}

/** Writes a temp document in the target's own directory, syncs it, then renames over the target. */
async function replaceAtomic(target: string, contents: string): Promise<void> {
  if (Buffer.byteLength(contents, "utf8") > MAX_TEXT_BYTES) {
    throw new Error(`Xiranite config document of ${Buffer.byteLength(contents, "utf8")} bytes exceeds the ${MAX_TEXT_BYTES} byte ceiling`)
  }
  const directory = dirname(target)
  await mkdir(directory, { recursive: true })
  const temp = join(directory, `${TEMP_PREFIX}${process.pid}-${sequence}-${Math.random().toString(36).slice(2, 8)}`)
  sequence += 1
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(temp, "wx")
    await handle.writeFile(contents, "utf8")
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temp, target)
  } catch (error) {
    await handle?.close().catch(() => undefined)
    await rm(temp, { force: true })
    throw error
  }
}

/** The Node/Bun half of the lock-and-replace protocol, in the seven primitives `transport.ts` names. */
export const nodeConfigTransport: ConfigTransport = {
  async read(path) {
    return await readOrNull(await canonicalWritablePath(path))
  },

  async exists(path) {
    try {
      await access(await canonicalWritablePath(path))
      return true
    } catch {
      return false
    }
  },

  async writeAtomic(path, contents, lockRetries) {
    const target = await canonicalWritablePath(path)
    const token = nextToken()
    await acquireLock(target, token, lockRetries ?? DEFAULT_LOCK_RETRIES)
    try {
      await replaceAtomic(target, contents)
      if ((await holderOf(target)) !== token) {
        throw new Error(`Xiranite config writer lock was compromised: ${target}`)
      }
    } finally {
      await releaseLock(target, token)
    }
  },

  async begin(path, lockRetries) {
    const target = await canonicalWritablePath(path)
    const token = nextToken()
    await acquireLock(target, token, lockRetries ?? DEFAULT_LOCK_RETRIES)
    return { token, contents: await readOrNull(target) }
  },

  async commit(path, token, contents) {
    const target = await canonicalWritablePath(path)
    if ((await holderOf(target)) !== token) {
      throw new Error(`Xiranite config writer lock was compromised: ${target}`)
    }
    try {
      await replaceAtomic(target, contents)
    } finally {
      await releaseLock(target, token)
    }
  },

  async abort(path, token) {
    const target = await canonicalWritablePath(path)
    const holder = await holderOf(target)
    if (holder !== null && holder !== token) {
      throw new Error(`Xiranite config writer lock was compromised: ${target}`)
    }
    await releaseLock(target, token)
  },

  async held(path, token) {
    const target = await canonicalWritablePath(path)
    return (await holderOf(target)) === token
  },
}

const io = createConfigIo(nodeConfigTransport)

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

export type {
  AtomicJsonFileOptions,
  LoadConfigOptions,
  LoadNodeConfigHintOptions,
  LoadNodeConfigHintResult,
  NodeConfigHintSink,
  NodeConfigResult,
  UpdateNodeConfigFileResult,
  UpdateXiraniteConfigOptions,
  UpdateXiraniteConfigResult,
  XiraniteConfigWriteOptions,
} from "./transport.js"
