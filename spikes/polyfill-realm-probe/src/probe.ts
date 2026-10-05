/**
 * Realm-side probe for the three polyfills that used to be hand-written in `packages/quickjs-shims`:
 * `node:buffer`, `node:events`, `node:string_decoder`.
 *
 * Everything here runs **inside the embedded QuickJS host** (`quickjs-run`), so this is the only place the claim
 * "we swapped in the npm implementation and it still evaluates in a realm" gets proved. The package's own Vitest
 * suite runs in Node, where `node:buffer` and the upstream port are interchangeable by construction.
 *
 * Shape follows a pure node (`crates/xiranite-quickjs-executor/src/node.rs`): `run(input)` returns the document.
 * Each check is `{ name, ok, detail }` and failures are collected, not thrown, so one document lists every gap.
 */
import { Buffer, atob, btoa, kMaxLength } from "node:buffer"
import { EventEmitter, getEventListeners, listenerCount, once } from "node:events"
import { StringDecoder } from "node:string_decoder"

interface Check {
  name: string
  ok: boolean
  detail?: unknown
}

interface ProbeResult {
  checks: Check[]
  failures: string[]
  engine: { bufferCtor: string; eventsCtor: string; decoderCtor: string }
}

export async function run(): Promise<ProbeResult> {
  const checks: Check[] = []
  const check = (name: string, ok: boolean, detail?: unknown): void => {
    checks.push(ok ? { name, ok } : { name, ok, detail })
  }

  // --- Buffer: the alias must land on the *same* Buffer the prelude published, not a second one. ---
  check("buffer-identity-with-global", (Buffer as unknown) === (globalThis as { Buffer?: unknown }).Buffer, {
    aliased: typeof Buffer,
    global: typeof (globalThis as { Buffer?: unknown }).Buffer,
  })
  check("buffer-utf8-byte-length", Buffer.from("héllo", "utf8").length === 6, Buffer.from("héllo", "utf8").length)
  check("buffer-hex-roundtrip", Buffer.from(Buffer.from("xï", "utf8").toString("hex"), "hex").toString("utf8") === "xï")
  check("buffer-base64-roundtrip", Buffer.from(Buffer.from("héllo", "utf8").toString("base64"), "base64").toString("utf8") === "héllo")
  check("buffer-latin1-byte-per-char", Buffer.from("é", "latin1").length === 1 && Buffer.from("é", "latin1").toString("latin1") === "é")
  // The gap the hand port refused and `buffer@6` closes:
  check("buffer-utf16le-roundtrip", Buffer.from("😀ab", "utf16le").toString("utf16le") === "😀ab", Buffer.from("😀ab", "utf16le").toString("utf16le"))
  check("buffer-alloc-fill", Array.from(Buffer.alloc(3).fill(7)).join(",") === "7,7,7")
  check("buffer-concat-length", Buffer.concat([Buffer.from("ab"), Buffer.from("cde")]).length === 5)
  check("buffer-isbuffer-rejects-plain-typed-array", Buffer.isBuffer(new Uint8Array(1)) === false)
  check("buffer-kmaxlength-is-number", typeof kMaxLength === "number" && kMaxLength > 0, kMaxLength)
  check("buffer-atob-btoa-latin1", atob(btoa("héllo")) === "héllo", atob(btoa("héllo")))

  // --- EventEmitter: order, counts, the error rethrow, and the module-level helpers. ---
  const emitter = new EventEmitter()
  const seen: string[] = []
  emitter.on("a", () => seen.push("on"))
  emitter.once("a", () => seen.push("once"))
  emitter.prependListener("a", () => seen.push("prepend"))
  check("emitter-first-emit-order", emitter.emit("a") === true && seen.join(",") === "prepend,on,once", seen)
  check("emitter-second-emit-drops-once", emitter.emit("a") === true && seen.join(",") === "prepend,on,once,prepend,on", seen)
  check("emitter-emit-without-listener-is-false", emitter.emit("nobody") === false)
  check("emitter-listener-count", emitter.listenerCount("a") === 2 && listenerCount(emitter, "a") === 2, [emitter.listenerCount("a"), listenerCount(emitter, "a")])
  check("emitter-get-event-listeners-size", getEventListeners(emitter, "a").size === 2, getEventListeners(emitter, "a").size)
  check("emitter-default-max-listeners-is-tens", EventEmitter.defaultMaxListeners === 10, EventEmitter.defaultMaxListeners)
  const boom = new Error("boom")
  let rethrown: unknown
  try {
    new EventEmitter().emit("error", boom)
  } catch (error) {
    rethrown = error
  }
  check("emitter-rethrows-the-same-error-object", rethrown === boom, rethrown)

  // `events@3.3.0` exports the Promise form of `once`; a realm pumps jobs, so this must settle.
  const waiter = new EventEmitter()
  const pending = once(waiter, "tick") as Promise<unknown[]>
  waiter.emit("tick", 1, "two")
  const resolved = await pending
  check("events-once-promise-resolves-with-args", Array.isArray(resolved) && resolved.length === 2 && resolved[0] === 1 && resolved[1] === "two", resolved)

  // --- StringDecoder: the split-and-hold arithmetic is the reason this module exists (iconv-lite drives it). ---
  const utf8 = new StringDecoder("utf8")
  check("decoder-holds-an-incomplete-sequence", utf8.write(Buffer.from([0xf0, 0x9f])) === "", utf8.write(Buffer.from([0xf0, 0x9f])))
  check("decoder-completes-on-the-next-write", utf8.write(Buffer.from([0x98, 0x80])) === "😀")
  const flush = new StringDecoder("utf8")
  // Node 26 answers one U+FFFD for an incomplete sequence flushed by `end()` (measured with `node -e`).
  const flushed = flush.end(Buffer.from([0xe2, 0x80]))
  check("decoder-end-emits-one-replacement", flushed === "\ufffd", flushed)
  const utf16 = new StringDecoder("utf16le")
  const encoded = Buffer.from("😀", "utf16le")
  check("decoder-utf16le-splits-and-joins", utf16.write(encoded.subarray(0, 2)) === "" && utf16.end(encoded.subarray(2)) === "😀")
  check("decoder-accepts-plain-typed-array", new StringDecoder("utf8").write(Uint8Array.from([0x68, 0x69])) === "hi", new StringDecoder("utf8").write(Uint8Array.from([0x68, 0x69])))
  check("decoder-end-accepts-plain-typed-array", new StringDecoder("utf8").end(Uint8Array.from([0xe2, 0x80])) === "\ufffd", new StringDecoder("utf8").end(Uint8Array.from([0xe2, 0x80])))
  // The single-byte path is the one that defeated a prototype patch (`simpleWrite` is the decoder's effective
  // write), and these three values are what Node 26 answers for the same bytes (`node -e`, measured).
  check("decoder-latin1-single-byte-path", new StringDecoder("latin1").write(Uint8Array.from([0xe9])) === "é", new StringDecoder("latin1").write(Uint8Array.from([0xe9])))
  check("decoder-ascii-masks-the-high-bit", new StringDecoder("ascii").write(Uint8Array.from([0xe9])) === "i", new StringDecoder("ascii").write(Uint8Array.from([0xe9])))
  const base64 = new StringDecoder("base64")
  check("decoder-base64-pads-the-remainder", base64.write(Uint8Array.from([0x00])) === "" && base64.end() === "AA==")

  const failures = checks.filter((entry) => !entry.ok).map((entry) => entry.name)
  return {
    checks,
    failures,
    engine: {
      bufferCtor: (Buffer as unknown as { name?: string }).name ?? "?",
      eventsCtor: (EventEmitter as unknown as { name?: string }).name ?? "?",
      decoderCtor: (StringDecoder as unknown as { name?: string }).name ?? "?",
    },
  }
}
