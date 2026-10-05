/**
 * `node:worker_threads` — the main-thread facts are real, the worker machinery is refused.
 *
 * Why it exists: `fflate` (bundled into many platform closures) probes
 * `createRequire("/")("worker_threads").threadId` to salt temp-file names, and `write-file-atomic`'s tmpname
 * path reads the same fact. Both are guarded (`try/catch`, fallback 0), so a module that answers the
 * main-thread facts and throws only when a worker is actually created keeps their fast path working and
 * refuses the impossible one loudly.
 *
 * The realm is single-threaded by construction (one QuickJS context per run, pumped by the host), so
 * `isMainThread`/`threadId` are not approximations — they are the truth about this environment.
 */
import { notImplemented, notImplementedClass } from "./internal.ts"

export const isMainThread = true
export const threadId = 0
export const parentPort = null
export const resourceLimits = Object.freeze({})
export const SHARE_ENV: symbol = Symbol.for("nodejs.worker_threads.SHARE_ENV")

const environmentData = new Map<string, unknown>()

/** Node's per-thread store; the realm has exactly one thread, so this is a plain realm-local map. */
export function getEnvironmentData(key: unknown): unknown {
  return environmentData.get(String(key))
}

export function setEnvironmentData(key: unknown, value?: unknown): void {
  if (value === undefined) environmentData.delete(String(key))
  else environmentData.set(String(key), value)
}

export const Worker: new (...args: unknown[]) => never = notImplementedClass(
  "worker_threads",
  "Worker",
  "worker_threads.spawn host service (the realm is one QuickJS context; a worker is a second engine)",
)
export const MessageChannel: new (...args: unknown[]) => never = notImplementedClass("worker_threads", "MessageChannel", "worker_threads.spawn host service")
export const MessagePort: new (...args: unknown[]) => never = notImplementedClass("worker_threads", "MessagePort", "worker_threads.spawn host service")
export const BroadcastChannel: new (...args: unknown[]) => never = notImplementedClass("worker_threads", "BroadcastChannel", "worker_threads.spawn host service")
export const receiveMessageOnPort: (port: unknown) => never = notImplemented("worker_threads", "receiveMessageOnPort", "worker_threads.spawn host service")
export const markAsUntransferable: (object: unknown) => never = notImplemented("worker_threads", "markAsUntransferable", "worker_threads.spawn host service")
export const isMarkedAsUntransferable: (object: unknown) => never = notImplemented("worker_threads", "isMarkedAsUntransferable", "worker_threads.spawn host service")
export const moveMessagePortToContext: (...args: unknown[]) => never = notImplemented("worker_threads", "moveMessagePortToContext", "worker_threads.spawn host service")
export const setEnvironmentDataSync: (...args: unknown[]) => never = notImplemented("worker_threads", "setEnvironmentDataSync", "worker_threads.spawn host service")

export default {
  isMainThread,
  threadId,
  parentPort,
  resourceLimits,
  SHARE_ENV,
  Worker,
  MessageChannel,
  MessagePort,
  BroadcastChannel,
  getEnvironmentData,
  setEnvironmentData,
}
