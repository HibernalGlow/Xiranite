/**
 * `node:events` — the implementation is npm `events` (the Joyent/browserify port of Node's own `events.js`, MIT),
 * installed under the alias `node-events` so this file's own import cannot collide with the esbuild
 * `--alias:events=<this file>` mapping. Same pattern as `assert.ts` and `stream.ts`: nothing here is ours except
 * the module-level helpers and the refusals.
 *
 * Why it exists: eight retained platform closures reach `require('events')` through bundled npm
 * (`signal-exit`, pulled in by `write-file-atomic`/`graceful-fs`, does `EE = require('events').EventEmitter` then
 * `new EE()`), and the specifier had no shim module at all, so the bundle kept it as an unmapped external
 * (gate WARN).
 *
 * What the swap changed, stated rather than pretended — each point measured against the installed
 * `events/events.js` 3.3.0:
 * - `once` is now the real thing, and it is upstream's **Promise** form (`module.exports.once`, :57), not Node
 *   16+'s async-iterator form. A Promise settles through the host job pump the realm already runs, so it works
 *   here; the iterator form still needs `Symbol.asyncIterator` plumbing and stays refused.
 * - The port has no `errorMonitor`, no `captureRejections`, no module-level statics for `setMaxListeners`/
 *   `getMaxListeners`, and no `getEventListeners` (`rg` over `events.js` answers zero hits for those names). The
 *   hand-written file routed `errorMonitor` inside `emit()`; exporting the symbol without that routing would be a
 *   silent divergence — a listener registered under it would never fire — so the symbol left the surface with it.
 *   `surface.ts` records it as `unsupported`, and a consumer that imports it fails at **build** time, which is the
 *   loud outcome esbuild's named-import resolution gives us for free.
 * - `MaxListenersExceededWarning` now prints (upstream's `ProcessEmitWarning` calls `console.warn`) where the hand
 *   port stayed silent. That matches Node; the realm's `console` is the host's.
 *
 * The module-level helpers delegate to the instance methods upstream actually has (`rawListeners`,
 * `listenerCount`, `setMaxListeners`, `getMaxListeners`), so they cannot drift from the class they introspect.
 */
import EventEmitter, { once } from "node-events"

import { QuickJsShimError, SHIM_ERROR_CODES } from "./host.ts"
import { notImplemented, notImplementedClass } from "./internal.ts"

export { EventEmitter, once }

export type Listener = (...args: any[]) => void

/**
 * What the module-level helpers can introspect. The duck-check keys off the public methods upstream defines, so it
 * accepts both a realm emitter and a real Node `EventEmitter`. An `EventTarget` cannot be introspected from inside
 * the realm (the host owns it), which is why `getEventListeners` throws for that arm instead of answering with an
 * empty Set that would read as "no listeners".
 */
export type EmitterLike = EventEmitter | EventTarget | object

/** Node's default is 10; read off the class so the number is upstream's, not transcribed. */
export const defaultMaxListeners: number = EventEmitter.defaultMaxListeners

/** The stored entries, wrappers included, like Node's: `rawListeners` is exactly that view. */
export function getEventListeners(emitter: EmitterLike, name: string | symbol): Set<Listener> {
  const target = emitter as Partial<{ rawListeners: (type: string | symbol) => Listener[] }>
  if (typeof target.rawListeners === "function") return new Set(target.rawListeners(name))
  throw new QuickJsShimError(
    SHIM_ERROR_CODES.memberUnsupported,
    "quickjs-shim: events.getEventListeners for an EventTarget is not implemented",
    { module: "events", member: "getEventListeners", requiredOperation: "a host-held listener registry for EventTarget" },
  )
}

export function listenerCount(emitter: EmitterLike, name: string | symbol): number {
  const target = emitter as Partial<{ listenerCount: (type: string | symbol) => number }>
  if (typeof target.listenerCount === "function") return target.listenerCount(name)
  const counts = (emitter as EventTarget & { eventCounts?: Map<string, number> }).eventCounts
  return typeof counts?.get === "function" ? (counts.get(String(name)) ?? 0) : 0
}

/**
 * Node's no-target form sets the default for emitters created afterwards; the realm has no
 * `process.globalEventTarget`, so that arm writes the class default, which is the same observable storage.
 */
export function setMaxListeners(count: number = EventEmitter.defaultMaxListeners, ...targets: EmitterLike[]): void {
  if (targets.length === 0) {
    EventEmitter.defaultMaxListeners = count
    return
  }
  for (const target of targets) {
    const setter = (target as Partial<{ setMaxListeners: (n: number) => unknown }>).setMaxListeners
    if (typeof setter === "function") setter.call(target, count)
  }
}

export function getMaxListeners(emitter: EmitterLike): number {
  const getter = (emitter as Partial<{ getMaxListeners: () => number }>).getMaxListeners
  return typeof getter === "function" ? getter.call(emitter) : EventEmitter.defaultMaxListeners
}

/** Node's `on()` is an async-iterator; the realm has no host event channel to iterate. */
export const on: (emitter: EventEmitter, name: string | symbol, options?: unknown) => never = notImplemented(
  "events",
  "on",
  "a host event channel the realm can async-iterate (ADR-0074 decision 5 host services)",
)

export const addAbortListener: (signal: unknown, listener: Listener) => never = notImplemented(
  "events",
  "addAbortListener",
  "a host-side cancellation signal (proc.cancel / run.cancel)",
)

/** Node's `EventEmitterAsyncResource` is a class, so the refusal has to be constructible-failing (see internal). */
export const EventEmitterAsyncResource: new (...args: unknown[]) => never = notImplementedClass(
  "events",
  "EventEmitterAsyncResource",
  "async_hooks, which the realm does not have",
)

const namespace = {
  EventEmitter,
  defaultMaxListeners,
  getEventListeners,
  listenerCount,
  setMaxListeners,
  getMaxListeners,
  once,
  on,
  addAbortListener,
  EventEmitterAsyncResource,
}
export default namespace
