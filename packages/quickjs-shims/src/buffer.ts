/**
 * The `Buffer` global — the implementation is npm `buffer` (Feross Aboukhadijeh's userland port of Node's
 * `Buffer`, MIT), installed under the alias `node-buffer` so this file's own import cannot collide with the
 * esbuild `--alias:buffer=<this file>` mapping. Same pattern as `node-assert`: the re-export list is ours, the
 * encoding machinery is upstream's.
 *
 * Not one of the eight `node:` builtins, and it would stay out of this package if the tree did not need it:
 * several platform closures touch `Buffer` directly (`comfygure/project.ts`, `encodeb`, `lorat`, `smartzip`,
 * `coveru`, `repacku`, `enginev`, plus bundled npm behind `logx`). QuickJS has no `Buffer`, so those reads would
 * be `ReferenceError`s that name nothing. The builder installs it as a realm global, and because
 * `string_decoder` → `safe-buffer` does `require('buffer')`, the specifier is also aliased to this file — one
 * `Buffer` for the whole bundle, not two.
 *
 * What the swap changed: the hand port carried utf8/latin1/hex/base64/ascii and refused `ucs2`/`utf16le`;
 * upstream implements Node's full `BufferTranscode` set, so `utf16le` now works and the code-page refusals that
 * remain are the ones Node itself would refuse in a no-ICU build. `gb18030` still throws — nodes that need a real
 * code page bundle `iconv-lite` (that is what `encodeb`/`soundw` do), and pure JS is the right place for it: no
 * host round-trip per chunk.
 *
 * What stays ours, because the host owns the bytes:
 * - `atob`/`btoa` cross the `__xrh` payload envelope (the base64/hex spelling of a host byte result is the wire
 *   convention from ADR-0071, not something a JS decoder gets to decide);
 * - `transpile` and `resolveObjectURL` are refusals — the realm has no VM compile step and no `blob:` URLs.
 *
 * `kMaxLength` and `INSPECT_MAX_BYTES` are read off the module rather than transcribed, so the numbers are
 * upstream's for the platform the bundle actually runs on.
 */
import { Buffer, INSPECT_MAX_BYTES, SlowBuffer, kMaxLength } from "node-buffer"

import { bytesFromHostPayload, bytesToBase64, bytesToLatin1, latin1ToBytes } from "./host.ts"
import { notImplemented } from "./internal.ts"

export { Buffer, INSPECT_MAX_BYTES, SlowBuffer, kMaxLength }

export const atob: (encoded: string) => string = (encoded) => bytesToLatin1(bytesFromHostPayload(encoded))
export const btoa: (text: string) => string = (text) => bytesToBase64(latin1ToBytes(text))

export const transpile: () => never = notImplemented("buffer", "transpile")
export const resolveObjectURL: () => never = notImplemented("buffer", "resolveObjectURL", "blob: URLs are not the realm's")

export default { Buffer, INSPECT_MAX_BYTES, SlowBuffer, kMaxLength, atob, btoa }
