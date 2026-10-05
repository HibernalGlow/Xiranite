/**
 * `node:string_decoder` — the implementation is npm `string_decoder` (the Joyent/browserify port of Node's own
 * `lib/string_decoder.js`, MIT), installed under the alias `node-string-decoder`. Same pattern as `stream.ts` and
 * `assert.ts`: the re-export list is ours, the algorithm is upstream's.
 *
 * Why it exists: `encodeb` bundles `iconv-lite`, whose internal codecs are thin wrappers over
 * `new StringDecoder(codec.enc)` (`encodings/internal.js:47-51`), and the specifier had no shim module, so the
 * platform bundle kept an unmapped external (gate WARN).
 *
 * What the swap changed: the hand port decoded only utf8/latin1/hex/base64/ascii and refused `utf16le`. Upstream
 * carries Node's own multi-byte split-and-hold arithmetic, so `utf16le`/`ucs2` now decode for real, and
 * `gb18030`/`cp932`-style code pages are still not this module's job — a node that needs one bundles
 * `iconv-lite`, which is pure JS and already in the graph (that is what `encodeb`/`soundw` do).
 *
 * Dependency note that decides the build configuration: upstream reaches `Buffer` through
 * `require('safe-buffer')`, and `safe-buffer` does `require('buffer')`. So `buffer` must be an **aliased**
 * specifier, not only a realm global — otherwise every bundle would carry a second, silently different `Buffer`
 * than the one `__xrh`'s byte helpers hand back. See `surface.ts` (`node:buffer` / bare `buffer`).
 *
 * One measured parity gap is closed here rather than left silent: `StringDecoder.prototype.write` funnels the
 * bytes through `buf.toString(encoding, offset)`, so on a real `Buffer` that is Node's own decode, but a plain
 * `Uint8Array` answers `Array.prototype.toString` — `new StringDecoder("utf8").write(Uint8Array.from([104,105]))`
 * yields `"104,105"` in the port against `"hi"` on Node 26 (measured with `node -e`, and the realm probe repeats
 * it). A wrong string is worse than an error, so the argument is normalised to a `Buffer` first, the way Node
 * does. `end()` gets the same treatment; `undefined` still means "flush what is held".
 *
 * The normaliser comes from `safe-buffer`, **not** from `./buffer.ts`, and that is load-bearing: upstream
 * `string_decoder` builds its internal `lastChar` through `safe-buffer`, so the class used to normalise input has
 * to be the class the decoder accepts. In the realm both resolve to our aliased `buffer@6`; under Vitest no alias
 * table applies, and mixing the two classes makes `buf.copy(target)` throw `argument should be a Buffer` — a real
 * failure mode this file had before the import was moved.
 *
 * Why the wrapper sits on the instance rather than on `StringDecoder.prototype`: for single-byte encodings the
 * port installs `simpleWrite` (`lib/string_decoder.js:289-291`, `return buf.toString(this.encoding)`) as the
 * decoder's own effective `write`, so a prototype patch is never reached — measured: with the prototype patched,
 * `latin1` still returned `"233"` for `Uint8Array.from([0xe9])` while `utf8` returned `"hi"`. The instance wrapper
 * covers every encoding, and it wraps whatever the constructor installed, so the utf8/utf16le split-and-hold
 * arithmetic stays upstream's untouched.
 */
import { Buffer as DecoderBuffer } from "safe-buffer"
import { StringDecoder as UpstreamStringDecoder } from "node-string-decoder"

function toBufferArgument(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value
  if (DecoderBuffer.isBuffer(value)) return value
  return ArrayBuffer.isView(value) ? DecoderBuffer.from(value) : value
}

/** Node's `StringDecoder`, with the argument normalised the way Node normalises it. */
export class StringDecoder extends UpstreamStringDecoder {
  constructor(encoding?: string) {
    super(encoding)

    const write = this.write as (value?: unknown) => string
    const end = this.end as (value?: unknown) => string
    this.write = ((value?: unknown) => write.call(this, toBufferArgument(value))) as typeof this.write
    this.end = ((value?: unknown) => end.call(this, value === undefined ? value : toBufferArgument(value))) as typeof this.end
  }
}

export default { StringDecoder }
