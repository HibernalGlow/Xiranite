/**
 * Parity tests for the `node:string_decoder` shim: the real `node:string_decoder` sits next to the shim in the
 * same Node process and both are driven through the same script, so the expectation is whatever Node exhibits.
 *
 * Why every payload here is a plain `Uint8Array` and never a `Buffer`: this file runs under Vitest, where the
 * bundle build's esbuild `--alias` table does **not** apply. The shim's own upstream `string_decoder` therefore
 * reaches `Buffer` through `safe-buffer` → Node's builtin `buffer`, while `./buffer.ts` hands out `buffer@6`'s
 * class. Two `Buffer` classes in one process make `buf.copy(target)` throw `argument should be a Buffer` for
 * reasons that have nothing to do with the realm. A `Uint8Array` is the one input both sides normalise, so the
 * comparison is between decoders, not between classes. The realm side (one class, aliased at build time) is
 * proved by `spikes/polyfill-realm-probe/`, and its identity check is what makes that safe.
 *
 * The `Uint8Array` cases also pin the parity fix `string-decoder.ts` adds: the 2019-era upstream port hands a
 * plain `Uint8Array` to `buf.toString(encoding, offset)`, which answers `"104,105"` where Node answers `"hi"`.
 */
import { describe, expect, it } from "vitest"
import { StringDecoder as NodeStringDecoder } from "node:string_decoder"

import { Buffer } from "./buffer.ts"
import { StringDecoder as ShimStringDecoder } from "./string-decoder.ts"

type Decoder = NodeStringDecoder
type DecoderEncoding = "utf8" | "utf16le" | "latin1"

const asDecoder = (decoder: ShimStringDecoder): Decoder => decoder as unknown as Decoder
const shim = (encoding: DecoderEncoding): Decoder => asDecoder(new ShimStringDecoder(encoding))
const real = (encoding: DecoderEncoding): Decoder => new NodeStringDecoder(encoding)
const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values)

function expectSameScript(encoding: DecoderEncoding, script: (decoder: Decoder) => unknown[]): void {
  const shimValue = script(shim(encoding))
  expect(shimValue).toEqual(script(real(encoding)))
  expect(shimValue.length).toBeGreaterThan(0)
}

describe("string_decoder shim matches node:string_decoder", () => {
  it("holds back an incomplete utf-8 sequence and completes it on the next write", () => {
    expectSameScript("utf8", (decoder) => [
      decoder.write(bytes(0xf0, 0x9f) as never),
      decoder.write(bytes(0x98, 0x80) as never),
      decoder.write(bytes(0x61) as never),
    ])
  })

  it("flushes a held incomplete sequence as one replacement character", () => {
    const transcript = (decoder: Decoder) => [decoder.write(bytes(0xe2, 0x80) as never), decoder.end(bytes() as never)]
    expect(transcript(shim("utf8"))).toEqual(transcript(real("utf8")))
    // Positive control, measured with `node -e`: the held half really is emitted, so a shim that dropped the
    // flush could not pass here.
    expect(transcript(real("utf8"))[1]).toBe("\ufffd")
  })

  it("keeps utf16le halves across writes, which the hand port refused outright", () => {
    const pair = Uint8Array.from(Buffer.from("😀", "utf16le"))
    const run = (decoder: Decoder) => [
      decoder.write(pair.subarray(0, 2) as never),
      decoder.end(pair.subarray(2) as never),
    ]
    expect(run(shim("utf16le"))).toEqual(run(real("utf16le")))
    // Positive control: the halves really do rejoin into the emoji.
    expect(run(real("utf16le")).join("")).toBe("😀")
  })

  it("accepts a plain Uint8Array, the gap that made the coercion necessary", () => {
    expect(shim("utf8").write(bytes(0x68, 0x69) as never)).toBe(real("utf8").write(bytes(0x68, 0x69) as never))
    // Positive control: under Node the bytes really spell "hi"; the raw port returned "104,105" instead.
    expect(real("utf8").write(bytes(0x68, 0x69) as never)).toBe("hi")
  })

  it("accepts a plain Uint8Array at end() too", () => {
    expect(shim("utf8").end(bytes(0xe2, 0x80) as never)).toBe(real("utf8").end(bytes(0xe2, 0x80) as never))
    expect(real("utf8").end(bytes(0xe2, 0x80) as never)).toBe("\ufffd")
  })

  it("decodes the encodings Node decodes, with the control values measured off Node", () => {
    const payload = bytes(0xe9) as never
    const shimDecoder = asDecoder(new ShimStringDecoder("latin1"))
    const realDecoder = new NodeStringDecoder("latin1")
    expect(shimDecoder.write(payload)).toBe(realDecoder.write(payload))
    expect(realDecoder.write(payload)).toBe("é")
    // The Buffer assertions exercise `buffer@6` on its own, with no decoder class in the way.
    expect(Buffer.from("héllo", "utf8").toString("hex")).toBe("68c3a96c6c6f")
    expect(Buffer.from("héllo", "utf8").toString("base64")).toBe("aMOpbGxv")
  })
})
