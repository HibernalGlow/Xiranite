/**
 * The `events` npm package (installed under the alias `node-events`) ships no types. This declares the members
 * `events.ts` re-exports so the shim compiles without implicit-any; the shapes are loose on purpose — the real
 * contract is Node's, and the port is upstream's, not ours.
 *
 * Measured against the installed `events/events.js` (3.3.0): the module object *is* the class
 * (`module.exports = EventEmitter`), it carries a self-reference (`EventEmitter.EventEmitter`, :60) and one free
 * function (`module.exports.once`, :57). There is no `getEventListeners`, no `errorMonitor`, no
 * `captureRejections` and no async-iterator `on` in this port — that absence is what `surface.ts` records.
 */
declare module "node-events" {
  export type UpstreamListener = (...args: any[]) => void

  export class EventEmitter {
    constructor(options?: { captureRejections?: boolean })
    static EventEmitter: typeof EventEmitter
    static defaultMaxListeners: number
    static init(this: EventEmitter): void
    /** `module.exports.once` lands on the class object, so the Promise form is also `EventEmitter.once`. */
    static once(emitter: EventEmitter, name: string | symbol): Promise<unknown[]>
    static listenerCount(emitter: EventEmitter, type: string | symbol): number
    on(type: string | symbol, listener: UpstreamListener): this
    addListener(type: string | symbol, listener: UpstreamListener): this
    once(type: string | symbol, listener: UpstreamListener): this
    prependListener(type: string | symbol, listener: UpstreamListener): this
    prependOnceListener(type: string | symbol, listener: UpstreamListener): this
    removeListener(type: string | symbol, listener: UpstreamListener): this
    off(type: string | symbol, listener: UpstreamListener): this
    removeAllListeners(type?: string | symbol): this
    emit(type: string | symbol, ...args: unknown[]): boolean
    listeners(type: string | symbol): UpstreamListener[]
    rawListeners(type: string | symbol): UpstreamListener[]
    listenerCount(type: string | symbol): number
    eventNames(): (string | symbol)[]
    setMaxListeners(n: number): this
    getMaxListeners(): number
  }

  /** The Promise form of `once` — not Node 16+'s async-iterator form, which is why it runs in a realm. */
  export function once(emitter: EventEmitter, name: string | symbol): Promise<unknown[]>

  export default EventEmitter
}
