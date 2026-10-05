/**
 * `node:events` — pure TypeScript, no host call.
 *
 * Why it exists: eight retained platform closures reach `require('events')` through bundled npm
 * (`signal-exit`, pulled in by `write-file-atomic`/`graceful-fs`, does `EE = require('events').EventEmitter`
 * then `new EE()`), and the specifier had no shim module at all, so the bundle kept it as an unmapped external
 * (gate WARN). `EventEmitter` is the one builtin here with a self-contained contract, so it is ported rather
 * than refused.
 *
 * Fidelity rules this file keeps, each measured against real Node 26 (`node -e`) and asserted in
 * `events.test.ts`:
 * - the instance fields are Node's own three: `_events`, `_eventsCount`, `_maxListeners`;
 * - `_events` is prototype-less (`{ __proto__: null }`), so `emit("constructor")` finds no handler;
 * - `emit(type)` returns `false` with no handler, `true` with one, and iterates a handler **array copy**;
 * - `emit("error", err)` with no `error` listener **rethrows the same `Error` object**; a non-`Error` argument
 *   throws `Error { code: "ERR_UNHANDLED_ERROR" }` with Node's `Unhandled error. ('str')` message shape;
 * - a numeric event name is stored under its string spelling (`on(3, fn)` then `listenerCount(3)` === 1);
 * - `once()` stores a wrapper carrying `.listener`; `rawListeners()` shows the wrapper, `listeners()` unwraps;
 * - `newListener` is emitted before the listener is stored (and only once a `newListener` handler exists),
 *   `removeListener` after it is gone; `removeAllListeners()` with no name emits nothing and clears everything;
 * - `defaultMaxListeners` is 10, `setMaxListeners(0)` means unlimited, `Infinity` is accepted, a negative or
 *   NaN count throws `RangeError { code: "ERR_OUT_OF_RANGE" }`;
 * - a non-function listener throws `TypeError { code: "ERR_INVALID_ARG_TYPE" }` with Node's wording.
 *
 * Two deliberate gaps. (1) No `MaxListenersExceededWarning` is printed: the realm has no stderr policy
 * (`process.stdout` is absent by design) and the warning is diagnostic only — the stored count is still
 * honoured. (2) `on`/`once`/`addAbortListener`/`EventEmitterAsyncResource` are refusals by name: an
 * async-iterator or AbortSignal API needs the host's event pump and a host cancellation signal, and a partial
 * re-implementation would answer `await once(emitter, "x")` differently from Node.
 */
import { QuickJsShimError, SHIM_ERROR_CODES } from "./host.ts"
import { notImplemented, notImplementedClass } from "./internal.ts"
import { inspect } from "./util.ts"

type Listener = (...args: any[]) => void
type OnceWrapper = Listener & { listener?: Listener }
type EventTable = Record<string | symbol, Listener | Listener[] | undefined>

/**
 * Node's `events.errorMonitor` is an **unregistered** symbol — `Symbol.keyFor(require("events").errorMonitor)`
 * measures `undefined` and the description is `events.errorMonitor` — so its identity only ever holds inside
 * one module instance. It is spelled the same way here: a realm emitter interoperates with the symbol this
 * module exports, and a consumer that compared it against a registry key would already be wrong in Node.
 */
export const errorMonitor: symbol = Symbol("events.errorMonitor")

/** Node's `events.captureRejectionSymbol`, kept as data because a consumer may test for its presence. */
export const captureRejectionSymbol: symbol = Symbol.for("nodejs.rejection")

/** Node's `events.usingDomains`: a realm has no domains, so this is the truthful `false`. */
export const usingDomains = false

const DEFAULT_MAX_LISTENERS = 10

/** Shared by the four refusals below: what the host would have to answer for them to work. */
const ASYNC_ITERATOR_OPERATION = "a host event channel the realm can async-iterate (ADR-0074 decision 5 host services)"

/**
 * Node's module-level `defaultMaxListeners` is a *settable* accessor; an ESM named export is a read-only
 * binding, so this value is write-once and the supported spelling in a realm is
 * `EventEmitter.defaultMaxListeners = n` (a real static property) or `emitter.setMaxListeners(n)`. Recorded in
 * `surface.ts` as the `defaultMaxListeners` setter gap rather than pretended away.
 */
export const defaultMaxListeners = DEFAULT_MAX_LISTENERS

function invalidListener(listener: unknown): TypeError {
  const received = listener === undefined || listener === null ? "" : ` (${inspect(listener)})`
  const error = new TypeError(
    `The "listener" argument must be of type function. Received type ${typeof listener}${received}`,
  ) as TypeError & { code: string }
  error.code = "ERR_INVALID_ARG_TYPE"
  return error
}

/**
 * Node renders the wrapped value with its own `util.inspect`, which quotes a plain string with single quotes.
 * The realm `inspect` in `util.ts` is deliberately JSON-style, so the label is spelled here to keep the measured
 * message (`Unhandled error. ('str')`) identical without changing `util.inspect` for every other consumer.
 */
function unhandledErrorLabel(value: unknown): string {
  if (typeof value === "string") return value.includes("'") ? JSON.stringify(value) : `'${value}'`
  return inspect(value)
}

/** Node's `ERR_UNHANDLED_ERROR`: an `Error` argument is rethrown untouched, anything else is wrapped. */
function unhandledError(value: unknown, emitter: EventEmitter): Error {
  if (value instanceof Error) return value
  const error = new Error(`Unhandled error. (${unhandledErrorLabel(value)})`) as Error & { code: string; context: unknown; arg: unknown }
  error.code = "ERR_UNHANDLED_ERROR"
  error.context = emitter
  error.arg = value
  return error
}

/**
 * Node does not validate an event name: `on({}, fn)` stores the listener under `"[object Object]"` and
 * `listenerCount({})` reads it back (both measured on Node 26). Keys therefore go through ordinary property
 * coercion, with a number keeping its string spelling — which is what `eventNames()` reports.
 */
function eventKey(name: string | number | symbol): string | symbol {
  return typeof name === "number" ? String(name) : (name as string | symbol)
}

/**
 * Node's `EventEmitter.init`: the constructor body spelled as a plain function, so `Stream.call(this)`
 * (graceful-fs's legacy-streams, and Node's own legacy `stream.Stream`) initialises a target that was never
 * built with `new`. A re-entrant init must not reset an existing table — the same guard Node uses.
 */
function initEmitter(target: EventEmitter): EventTable {
  const events = target._events
  if (events === undefined || events === (Object.getPrototypeOf(target) as EventEmitter)._events) {
    target._events = Object.create(null) as EventTable
    target._eventsCount = 0
    target._maxListeners = undefined
  }
  return target._events!
}

/** `events.init` is that same initialiser, reached through `init.call(object)` in legacy packages. */
export function init(this: EventEmitter | undefined): void {
  if (this !== undefined && this !== null) initEmitter(this)
}

/** The initialiser both the callable `EventEmitter` and (never externally used) the prototype class share. */
function constructEmitter(target: EventEmitter, options?: { captureRejections?: boolean }): void {
  initEmitter(target)
  // Node captures listener rejections only under this option; emulating it silently would change what a
  // throwing listener does, so the option is refused by name instead.
  if (options?.captureRejections === true) throw captureRejectionsRefusal()
}

class EventEmitterPrototype {
  _events?: EventTable
  _eventsCount = 0
  _maxListeners: number | undefined = undefined

  /** Node's `EventEmitter.defaultMaxListeners`, readable before any instance exists. */
  static defaultMaxListeners = DEFAULT_MAX_LISTENERS

  constructor(options?: { captureRejections?: boolean }) {
    constructEmitter(this, options)
  }

  setMaxListeners(count: number): this {
    if (typeof count !== "number" || Number.isNaN(count) || count < 0) {
      const error = new RangeError(
        `The value of "n" is out of range. It must be a non-negative number. Received ${inspect(count)}`,
      ) as RangeError & { code: string }
      error.code = "ERR_OUT_OF_RANGE"
      throw error
    }
    this._maxListeners = count
    return this
  }

  getMaxListeners(): number {
    return this._maxListeners === undefined ? EventEmitter.defaultMaxListeners : this._maxListeners
  }

  emit(name: string | symbol, ...args: unknown[]): boolean {
    const key = eventKey(name)
    const handlers = this._events?.[key]
    if (handlers === undefined) {
      if (key === "error") {
        const monitor = this._events?.[errorMonitor]
        if (monitor !== undefined) callAll(monitor, args)
        throw unhandledError(args[0], this)
      }
      return false
    }
    callAll(handlers, args)
    return true
  }

  addListener(name: string | symbol, listener: Listener): this {
    return appendListener(this, eventKey(name), listener, false, false)
  }

  on(name: string | symbol, listener: Listener): this {
    return appendListener(this, eventKey(name), listener, false, false)
  }

  prependListener(name: string | symbol, listener: Listener): this {
    return appendListener(this, eventKey(name), listener, true, false)
  }

  once(name: string | symbol, listener: Listener): this {
    return appendListener(this, eventKey(name), listener, false, true)
  }

  prependOnceListener(name: string | symbol, listener: Listener): this {
    return appendListener(this, eventKey(name), listener, true, true)
  }

  removeListener(name: string | symbol, listener: Listener): this {
    const key = eventKey(name)
    const events = this._events
    if (events === undefined || typeof listener !== "function") return this
    const handlers = events[key]
    if (handlers === undefined) return this

    if (handlers === listener || (handlers as OnceWrapper).listener === listener) {
      forget(events, key, this)
    } else if (Array.isArray(handlers)) {
      for (let index = handlers.length - 1; index >= 0; index -= 1) {
        const entry = handlers[index] as OnceWrapper
        if (entry === listener || entry.listener === listener) {
          if (handlers.length === 1) forget(events, key, this)
          else handlers.splice(index, 1)
          break
        }
      }
    } else {
      return this
    }

    if (this._events?.removeListener !== undefined) this.emit("removeListener", key, listener)
    return this
  }

  off(name: string | symbol, listener: Listener): this {
    return this.removeListener(name, listener)
  }

  /**
   * Node's `removeAllListeners()` removes through `removeListener`, so the `removeListener` hook fires per
   * listener and no `removeAllListeners` event is emitted on this path (measured against Node 26 and bun:
   * `rm:z, rm:z, rm:removeAllListeners, rm:y` for a two-listener event plus a bare `removeAllListeners()`).
   * The `removeListener` key itself is cleared last, and because the guard below re-reads the live table, its
   * own removal emits nothing.
   */
  removeAllListeners(name?: string | symbol): this {
    const events = this._events
    if (events === undefined) return this
    if (name === undefined) {
      for (const key of Reflect.ownKeys(events)) {
        if (key !== "removeListener") this.removeAllListeners(key)
      }
      this.removeAllListeners("removeListener")
      this._events = Object.create(null) as EventTable
      this._eventsCount = 0
      return this
    }
    const key = eventKey(name)
    const handlers = events[key]
    if (typeof handlers === "function") this.removeListener(key, handlers)
    else if (Array.isArray(handlers)) {
      for (let index = handlers.length - 1; index >= 0; index -= 1) this.removeListener(key, handlers[index] as Listener)
    }
    return this
  }

  listeners(name: string | symbol): Listener[] {
    return this.rawListeners(name).map((entry) => (entry as OnceWrapper).listener ?? entry)
  }

  rawListeners(name: string | symbol): Listener[] {
    const handlers = this._events?.[eventKey(name)]
    if (handlers === undefined) return []
    return Array.isArray(handlers) ? handlers.slice() : [handlers as Listener]
  }

  listenerCount(name: string | symbol): number {
    return countFor(this._events?.[eventKey(name)])
  }

  eventNames(): (string | symbol)[] {
    return this._events === undefined ? [] : Reflect.ownKeys(this._events)
  }

  static listenerCount(emitter: EventEmitter, name: string | symbol): number {
    return countFor(emitter._events?.[eventKey(name)])
  }

  static setMaxListeners(count: number, ...emitters: EventEmitter[]): void {
    for (const emitter of emitters) emitter?.setMaxListeners?.(count)
  }

  static getMaxListeners(emitter: EventEmitter): number {
    return typeof emitter?.getMaxListeners === "function" ? emitter.getMaxListeners() : EventEmitter.defaultMaxListeners
  }

  /** Node's `events.once(emitter, name)` is an async iterator; refused by name (see the module header). */
  static once: (emitter: EventEmitter, name: string | symbol, options?: unknown) => never = notImplemented("events", "once", ASYNC_ITERATOR_OPERATION)

  /** Node's `events.on(emitter, name)` is an async iterator; refused by name (see the module header). */
  static on: (emitter: EventEmitter, name: string | symbol, options?: unknown) => never = notImplemented("events", "on", ASYNC_ITERATOR_OPERATION)
}

export interface EventEmitter extends EventEmitterPrototype {}

/**
 * Node's `EventEmitter` is a **function**, not a class, and that is load-bearing: `readable-stream` (and
 * `graceful-fs`'s legacy streams) inherit ES5-style with `EventEmitter.call(this)`, which throws on a class —
 * measured in this realm, the banner error was `class constructors must be invoked with 'new'` raised from
 * `Readable.from(...)` → `Stream.prototype` chain. The callable wrapper runs the same initialiser the class
 * constructor runs and shares the class's prototype, so `new EventEmitter()`, `.call(this)`, `instanceof` and
 * subclassing all behave like Node.
 */
export const EventEmitter = function EventEmitter(this: unknown, options?: { captureRejections?: boolean }): void {
  constructEmitter(this as EventEmitter, options)
} as unknown as typeof EventEmitterPrototype

;(EventEmitter as { prototype: unknown }).prototype = EventEmitterPrototype.prototype
const { prototype: _classPrototype, length: _classLength, name: _className, ...eventEmitterStatics } = Object.getOwnPropertyDescriptors(EventEmitterPrototype)
Object.defineProperties(EventEmitter, eventEmitterStatics)

function forget(events: EventTable, key: string | symbol, emitter: EventEmitter): void {
  if (--emitter._eventsCount === 0) emitter._events = Object.create(null) as EventTable
  else delete events[key]
}

function captureRejectionsRefusal(): QuickJsShimError {
  return new QuickJsShimError(
    SHIM_ERROR_CODES.memberUnsupported,
    "quickjs-shim: events.EventEmitter({ captureRejections: true }) is not implemented",
    { module: "events", member: "captureRejections", requiredOperation: "an async_hooks / rejection host surface" },
  )
}

function countFor(handlers: Listener | Listener[] | undefined): number {
  if (handlers === undefined) return 0
  return Array.isArray(handlers) ? handlers.length : 1
}

function callAll(handlers: Listener | Listener[], args: unknown[]): void {
  if (Array.isArray(handlers)) {
    for (const listener of handlers.slice()) listener(...args)
    return
  }
  handlers(...args)
}

function appendListener<T extends EventEmitter>(emitter: T, key: string | symbol, listener: Listener, prepend: boolean, once: boolean): T {
  if (typeof listener !== "function") throw invalidListener(listener)
  const events = initEmitter(emitter)
  const stored: OnceWrapper = once ? wrapOnce(listener, key, emitter) : listener

  if (events.newListener !== undefined) emitter.emit("newListener", key, unwrap(stored))

  const existing = events[key]
  if (existing === undefined) {
    events[key] = stored
    emitter._eventsCount += 1
  } else if (Array.isArray(existing)) {
    if (prepend) existing.unshift(stored)
    else existing.push(stored)
  } else {
    events[key] = prepend ? [stored, existing] : [existing, stored]
  }
  return emitter
}

/**
 * Node's `once` wrapper: it removes *itself* (through the emitter it was stored on and the event name it was
 * added under) before running, so a listener added twice with `once` runs twice and `listeners()` still reports
 * the original function.
 */
function wrapOnce(listener: Listener, key: string | symbol, emitter: EventEmitter): OnceWrapper {
  const wrapper = function (this: unknown, ...args: unknown[]): void {
    emitter.removeListener(key, wrapper)
    listener.apply(this, args)
  } as OnceWrapper
  wrapper.listener = listener
  return wrapper
}

function unwrap(listener: OnceWrapper): Listener {
  return listener.listener ?? listener
}

/**
 * `getEventListeners` returns the *stored* entries (wrappers included), like Node's. An `EventTarget` cannot be
 * introspected from inside the realm — the host owns it — so that half throws instead of answering with an
 * empty Set, which would read as "no listeners".
 */
export function getEventListeners(emitter: EventEmitter | EventTarget, name: string | symbol): Set<Listener> {
  const target = emitter as EventEmitter
  if (target !== null && typeof target === "object" && target._events !== undefined) {
    const handlers = target._events[eventKey(name)]
    if (handlers === undefined) return new Set()
    return new Set(Array.isArray(handlers) ? handlers.slice() : [handlers as Listener])
  }
  throw new QuickJsShimError(
    SHIM_ERROR_CODES.memberUnsupported,
    "quickjs-shim: events.getEventListeners for an EventTarget is not implemented",
    { module: "events", member: "getEventListeners", requiredOperation: "a host-held listener registry for EventTarget" },
  )
}

export function listenerCount(emitter: EventEmitter | EventTarget, name: string | symbol): number {
  const target = emitter as EventEmitter
  if (target !== null && typeof target === "object" && target._events !== undefined) {
    return countFor(target._events[eventKey(name)])
  }
  const counts = (emitter as EventTarget & { eventCounts?: Map<string, number> }).eventCounts
  return typeof counts?.get === "function" ? (counts.get(String(name)) ?? 0) : 0
}

export function setMaxListeners(count: number = EventEmitter.defaultMaxListeners, ...targets: (EventEmitter | EventTarget)[]): void {
  EventEmitter.setMaxListeners(count, ...(targets as EventEmitter[]))
}

export function getMaxListeners(emitter: EventEmitter | EventTarget): number {
  return typeof (emitter as EventEmitter).getMaxListeners === "function"
    ? (emitter as EventEmitter).getMaxListeners()
    : EventEmitter.defaultMaxListeners
}

/** `events.once` / `events.on` as free functions, and `addAbortListener`: all need the host event pump. */
export const once: (emitter: EventEmitter, name: string | symbol, options?: unknown) => never = notImplemented("events", "once", ASYNC_ITERATOR_OPERATION)
export const on: (emitter: EventEmitter, name: string | symbol, options?: unknown) => never = notImplemented("events", "on", ASYNC_ITERATOR_OPERATION)

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
  defaultMaxListeners: EventEmitter.defaultMaxListeners,
  errorMonitor,
  captureRejectionSymbol,
  usingDomains,
  init,
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
