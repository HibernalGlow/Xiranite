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
 */
import { StringDecoder } from "node-string-decoder"

export { StringDecoder }

export default { StringDecoder }
