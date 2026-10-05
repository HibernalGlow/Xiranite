/**
 * Fidelity tests for the `node:events` shim. They run in a Node/Bun process, so the *real* `node:events` is
 * imported next to the shim and both are driven through the same script; every expectation is a behaviour the
 * real implementation exhibits (cross-checked against Node 26 and bun 1.4.2 before being written down here),
 * not one the shim invented.
 *
 * The shim instance is handed to the drivers through Node's own `EventEmitter` type, so the shim also has to
 * satisfy the published declaration.
 */
import { describe, expect, it } from "bun:test"
import { EventEmitter as NodeEventEmitter, defaultMaxListeners as nodeDefaultMaxListeners, errorMonitor as nodeErrorMonitor, once as nodeOnce } from "node:events"

import {
  EventEmitter as ShimEventEmitter,
  defaultMaxListeners,
  errorMonitor,
  EventEmitterAsyncResource,
  getEventListeners,
  listenerCount,
  on as shimOn,
  once as shimOnce,
  addAbortListener,
} from "./events.ts"

type Emitter = NodeEventEmitter

const asEmitter = (emitter: ShimEventEmitter): Emitter => emitter as unknown as Emitter
const shim = (): Emitter => asEmitter(new ShimEventEmitter())
const real = (): Emitter => new NodeEventEmitter()

/** Both implementations must produce the identical transcript for the identical script. */
function expectSameScript(script: (emitter: Emitter) => unknown[]): void {
  expect(script(shim())).toEqual(script(real()))
}

describe("events shim matches node:events", () => {
  it("runs the same listener script with the same order, return values and counts", () => {
    expectSameScript((emitter) => {
      const events: string[] = []
      emitter.on("a", (value: unknown) => events.push(`a1:${String(value)}`))
      emitter.once("a", (value: unknown) => events.push(`a2:${String(value)}`))
      emitter.prependListener("a", (value: unknown) => events.push(`a0:${String(value)}`))
      const first = emitter.emit("a", 1)
      const second = emitter.emit("a", 2)
      const third = emitter.emit("nobody")
      return [
        events,
        first,
        second,
        third,
        emitter.listenerCount("a"),
        emitter.eventNames().map(String).sort(),
        emitter.rawListeners("a").length,
        emitter.listeners("a").length,
      ]
    })
  })

  it("emits newListener before storing and removeListener after removing, like Node", () => {
    expectSameScript((emitter) => {
      const seen: string[] = []
      emitter.on("newListener", (name: string | symbol, listener: (...args: unknown[]) => void) => seen.push(`new:${String(name)}:${listener.name || "anon"}`))
      emitter.on("removeListener", (name: string | symbol) => seen.push(`rm:${String(name)}`))
      emitter.on("a", function namedA() {})
      emitter.once("b", function namedB() {})
      emitter.removeListener("a", emitter.listeners("a")[0]!)
      emitter.removeAllListeners()
      return [seen, emitter.eventNames().map(String)]
    })
  })

  it("removes through removeListener on removeAllListeners, so no removeAllListeners event fires", () => {
    const transcript = (emitter: Emitter) => {
      const log: string[] = []
      emitter.on("removeAllListeners", (name: string | symbol) => log.push(`ral:${String(name)}`))
      emitter.on("removeListener", (name: string | symbol) => log.push(`rm:${String(name)}`))
      emitter.on("z", function Z() {})
      emitter.on("z", function Z2() {})
      emitter.removeAllListeners("z")
      emitter.on("y", function Y() {})
      emitter.removeAllListeners()
      return [log, emitter.eventNames().map(String)]
    }
    expectSameScript(transcript)
    // The transcript is non-empty and matches the shape measured on Node 26 + bun 1.4.2.
    expect(transcript(real())[0].length).toBeGreaterThan(0)
  })

  it("keeps Node's three instance fields and a prototype-less event table", () => {
    expect(Object.keys(new ShimEventEmitter()).sort()).toEqual(Object.keys(new NodeEventEmitter()).sort())
    const table = (new ShimEventEmitter() as unknown as { _events: object })._events
    expect(Object.getPrototypeOf(table)).toBeNull()
    // An inherited property must not read as a listener.
    expect(shim().emit("constructor" as never)).toBe(false)
    expect(real().emit("constructor" as never)).toBe(false)
  })

  it("rethrows the same Error object for an unhandled error event", () => {
    const boom = new Error("boom")
    let realCaught: unknown
    let shimCaught: unknown
    try {
      real().emit("error", boom)
    } catch (error) {
      realCaught = error
    }
    try {
      shim().emit("error", boom)
    } catch (error) {
      shimCaught = error
    }
    expect(shimCaught).toBe(realCaught)
    expect(shimCaught).toBe(boom)

    const wrapped = (emitter: Emitter) => {
      try {
        emitter.emit("error", "str")
      } catch (error) {
        const typed = error as Error & { code?: string }
        return [typed.constructor.name, typed.code, typed.message]
      }
      return ["did not throw"]
    }
    expectSameScript(wrapped)
  })

  it("routes an errorMonitor listener the way Node does", () => {
    // Node's symbol is unregistered, so identity cannot be shared across modules: the parity that is checkable
    // is the description and the absence of a registry key.
    expect(errorMonitor.description).toBe(nodeErrorMonitor.description)
    // Node 26 leaves this symbol unregistered (`Symbol.keyFor(...)` -> undefined) while bun 1.4.2 registers it
    // under "events.errorMonitor". The shim follows Node, whose surface is the one being ported.
    expect(Symbol.keyFor(errorMonitor)).toBeUndefined()

    const seen: unknown[] = []
    const emitter = new ShimEventEmitter()
    emitter.on(errorMonitor, (value: unknown) => seen.push(value))
    expect(() => emitter.emit("error", "x")).toThrow()
    expect(seen).toEqual(["x"])

    // A real Node emitter behaves the same under its own symbol.
    const realSeen: unknown[] = []
    const realEmitter = new NodeEventEmitter()
    realEmitter.on(nodeErrorMonitor, (value: unknown) => realSeen.push(value))
    expect(() => realEmitter.emit("error", "x")).toThrow()
    expect(realSeen).toEqual(seen)
  })

  it("rejects a non-function listener and an unusable event name with Node's error codes", () => {
    const check = (emitter: Emitter) => {
      const out: string[] = []
      try {
        emitter.on("x", 3 as never)
      } catch (error) {
        const typed = error as TypeError & { code?: string }
        out.push(`${typed.constructor.name}:${typed.code}:${typed.message}`)
      }
      try {
        emitter.emit({} as never)
      } catch (error) {
        const typed = error as TypeError & { code?: string }
        out.push(`${typed.constructor.name}:${typed.code}`)
      }
      return out
    }
    expectSameScript(check)
  })

  it("honours the max-listeners storage and Node's out-of-range errors", () => {
    const check = (emitter: Emitter) => {
      const out: unknown[] = [emitter.getMaxListeners()]
      emitter.setMaxListeners(0)
      out.push(emitter.getMaxListeners())
      emitter.setMaxListeners(Infinity)
      out.push(emitter.getMaxListeners())
      for (const bad of [-1, Number.NaN]) {
        try {
          emitter.setMaxListeners(bad)
        } catch (error) {
          const typed = error as RangeError & { code?: string }
          out.push(`${typed.constructor.name}:${typed.code}`)
        }
      }
      return out
    }
    expectSameScript(check)
    expect(defaultMaxListeners).toBe(nodeDefaultMaxListeners)
    expect(ShimEventEmitter.defaultMaxListeners).toBe(10)
  })

  it("keys numeric event names like Node does", () => {
    const check = (emitter: Emitter) => {
      emitter.on(3 as never, () => {})
      return [emitter.eventNames().map(String), emitter.listenerCount(3 as never), emitter.listeners("3").length]
    }
    expectSameScript(check)
  })

  it("exposes module-level getEventListeners/listenerCount over emitters", () => {
    const listener = () => {}
    const shimEmitter = new ShimEventEmitter()
    const realEmitter = new NodeEventEmitter()
    shimEmitter.on("x", listener)
    realEmitter.on("x", listener)
    expect(getEventListeners(asEmitter(shimEmitter), "x")).toEqual(getEventListeners(realEmitter, "x"))
    expect(getEventListeners(asEmitter(shimEmitter), "x")).toEqual(new Set([listener]))
    expect(listenerCount(asEmitter(shimEmitter), "x")).toBe(listenerCount(realEmitter, "x"))
    expect(listenerCount(asEmitter(shimEmitter), "x")).toBe(1)
  })

  it("refuses the async-iterator and abort-signal surface by name", () => {
    const emitter = new ShimEventEmitter()
    const refusal = (call: () => unknown): string => {
      try {
        call()
      } catch (error) {
        return `${(error as Error).message}|${(error as Error & { code?: string }).code}`
      }
      return "did not throw"
    }
    expect(refusal(() => shimOnce(emitter, "x"))).toBe("quickjs-shim: events.once is not implemented|quickjs-shim-member-unsupported")
    expect(refusal(() => shimOn(emitter, "x"))).toBe("quickjs-shim: events.on is not implemented|quickjs-shim-member-unsupported")
    expect(refusal(() => (ShimEventEmitter.once as unknown as () => unknown)(emitter, "x"))).toBe("quickjs-shim: events.once is not implemented|quickjs-shim-member-unsupported")
    expect(refusal(() => addAbortListener(new AbortController().signal, () => {}))).toBe(
      "quickjs-shim: events.addAbortListener is not implemented|quickjs-shim-member-unsupported",
    )
    expect(refusal(() => new (EventEmitterAsyncResource as unknown as () => unknown)())).toBe(
      "quickjs-shim: events.EventEmitterAsyncResource is not implemented|quickjs-shim-member-unsupported",
    )
    // The real Node surface exists, which is why these are refusals and not silent absences.
    expect(typeof nodeOnce).toBe("function")
  })

  it("refuses captureRejections instead of silently changing listener error handling", () => {
    expect(() => new ShimEventEmitter({ captureRejections: true })).toThrow(/captureRejections/)
  })
})
