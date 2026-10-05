/**
 * Fidelity tests for the `node:events` shim. They run in a Node/Bun process, so the *real* `node:events` is
 * imported next to the shim and both are driven through the same script; every expectation is a behaviour the
 * real implementation exhibits (cross-checked against Node 26 and bun 1.4.2 before being written down here),
 * not one the shim invented.
 *
 * The shim instance is handed to the drivers through Node's own `EventEmitter` type, so the shim also has to
 * satisfy the published declaration.
 */
import { describe, expect, it } from "vitest"
import { EventEmitter as NodeEventEmitter, defaultMaxListeners as nodeDefaultMaxListeners, errorMonitor as nodeErrorMonitor, once as nodeOnce } from "node:events"

import {
  EventEmitter as ShimEventEmitter,
  defaultMaxListeners,
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
      emitter.removeListener("a", emitter.listeners("a")[0] as (...args: unknown[]) => void)
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

    // Measured divergence, pinned rather than hidden (`node -e` against `node-events` 3.3.0 and Node 26, same
    // call): both throw an `Error` out of the same call; only Node carries `code: "ERR_UNHANDLED_ERROR"`, and the
    // port's message is `Unhandled error. (undefined)` where Node quotes the value. So the two are asserted
    // separately instead of forced through one transcript — the half that matters (an Error escapes when nothing
    // listens for `error`) is equal, the diagnostic half is not.
    const wrapped = (emitter: Emitter) => {
      try {
        emitter.emit("error", "str")
      } catch (error) {
        const typed = error as Error & { code?: string }
        return [typed.constructor.name, Boolean(typed.code)]
      }
      return ["did not throw"]
    }
    expect(wrapped(real())).toEqual(["Error", true])
    expect(wrapped(shim())).toEqual(["Error", false])
  })

  it("resolves the Promise form of once with the emitted arguments, like Node", async () => {
    const run = async (emitter: Emitter, once: (target: Emitter, name: string) => Promise<unknown[]>) => {
      const pending = once(emitter, "x")
      emitter.emit("x", 1, "two")
      return pending
    }
    const shimOnceFn = shimOnce as unknown as (target: Emitter, name: string) => Promise<unknown[]>
    const nodeOnceFn = nodeOnce as unknown as (target: Emitter, name: string) => Promise<unknown[]>
    const shimValue = await run(shim(), shimOnceFn)
    const realValue = await run(real(), nodeOnceFn)
    expect(shimValue).toEqual(realValue)
    expect(shimValue).toEqual([1, "two"])
  })

  it("does not hand out an errorMonitor symbol the port cannot route", async () => {
    // Positive control first: Node really has the symbol and really does route it through emit("error"). That is
    // precisely why the shim may not export a symbol its own emit() would never consult — a listener registered
    // under it would silently never fire. `events@3.3.0` has no errorMonitor at all (zero `rg` hits in
    // `events.js`), so the name is absent from the module and `surface.ts` records the gap.
    expect(typeof nodeErrorMonitor).toBe("symbol")
    const realEmitter = new NodeEventEmitter()
    const realSeen: unknown[] = []
    realEmitter.on(nodeErrorMonitor, (value: unknown) => realSeen.push(value))
    expect(() => realEmitter.emit("error", "x")).toThrow()
    expect(realSeen).toEqual(["x"])

    const shimModule = (await import("./events.ts")) as Record<string, unknown>
    expect(shimModule["errorMonitor"]).toBeUndefined()
    expect(shimModule["captureRejectionSymbol"]).toBeUndefined()
    expect(shimModule["usingDomains"]).toBeUndefined()
  })

  it("rejects a non-function listener with the same error type, and pins the code gap", () => {
    const check = (emitter: Emitter) => {
      const out: unknown[] = []
      try {
        emitter.on("x", 3 as never)
      } catch (error) {
        const typed = error as TypeError & { code?: string }
        out.push([typed.constructor.name, Boolean(typed.code)])
      }
      // Measured: Node 26 answers `false` rather than throwing for an unusable name with no listener, and so does
      // the port. Kept in the same transcript because this half *is* equal.
      out.push(emitter.emit({} as never))
      return out
    }
    expect(check(real())).toEqual([["TypeError", true], false])
    expect(check(shim())).toEqual([["TypeError", false], false])
  })

  it("honours the max-listeners storage the way Node does", () => {
    const storage = (emitter: Emitter) => {
      const out: unknown[] = [emitter.getMaxListeners()]
      emitter.setMaxListeners(0)
      out.push(emitter.getMaxListeners())
      emitter.setMaxListeners(Infinity)
      out.push(emitter.getMaxListeners())
      return out
    }
    expectSameScript(storage)
    expect(storage(real())).toEqual([10, 0, Infinity])
    expect(defaultMaxListeners).toBe(nodeDefaultMaxListeners)
    expect(ShimEventEmitter.defaultMaxListeners).toBe(10)
  })

  it("still throws a RangeError for an out-of-range listener count, without Node's code", () => {
    // `events@3.3.0` validates the count (Node 26's own message shape, minus the `ERR_OUT_OF_RANGE` code), so the
    // throw and the value are equal and only the code differs — asserted per side, not squashed into one parity
    // script that would silently pass if the guard disappeared.
    const check = (emitter: Emitter) => {
      try {
        emitter.setMaxListeners(-1)
      } catch (error) {
        const typed = error as RangeError & { code?: string }
        return [typed.constructor.name, Boolean(typed.code)]
      }
      return ["did not throw"]
    }
    expect(check(real())).toEqual(["RangeError", true])
    expect(check(shim())).toEqual(["RangeError", false])
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
    expect(refusal(() => shimOn(emitter, "x"))).toBe("quickjs-shim: events.on is not implemented|quickjs-shim-member-unsupported")
    expect(refusal(() => addAbortListener(new AbortController().signal, () => {}))).toBe(
      "quickjs-shim: events.addAbortListener is not implemented|quickjs-shim-member-unsupported",
    )
    expect(refusal(() => new (EventEmitterAsyncResource as unknown as new (...args: unknown[]) => unknown)())).toBe(
      "quickjs-shim: events.EventEmitterAsyncResource is not implemented|quickjs-shim-member-unsupported",
    )
    // The real Node surface exists, which is why these are refusals and not silent absences.
    expect(typeof nodeOnce).toBe("function")
  })

  it("ignores captureRejections without swallowing an unhandled error", () => {
    // `events@3.3.0` reads no `captureRejections` option, so the observable truth is that an unhandled `error`
    // emission still throws. Node with the option enabled would instead turn it into a rejection; `surface.ts`
    // lists `captureRejections` as unsupported rather than pretending the two are the same.
    const emitter = new ShimEventEmitter({ captureRejections: true })
    expect(() => emitter.emit("error", new Error("boom"))).toThrow(/boom/)
  })
})
