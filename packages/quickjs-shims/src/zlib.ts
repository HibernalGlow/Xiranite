/**
 * `node:zlib` — the brotli **decoder** is real; the encoder and the gzip/deflate family are refused.
 *
 * Why it exists: `comfygure` stores content blobs as brotli (`compressBrotli`/`decompressBrotli` at
 * `packages/nodes/comfygure/src/project.ts:36-37`, guarded by `COMFYGURE_CONTENT_COMPRESSION_THRESHOLD`).
 *
 * What was measured before choosing this shape (2026-10-05, this machine):
 * - the realm has **no `WebAssembly`** (`quickjs-run` probe answers `typeof WebAssembly === "undefined"`), so
 *   `brotli-wasm`/`brotli-compress` and every other wasm-backed encoder are out;
 * - the `brotli` npm package's **encoder is emscripten** and fails even on stock Node 26
 *   (`node -e 'require("brotli").compress(Buffer.from("x"), {quality:5})'` → `Cannot read properties of null`),
 *   so it cannot be the encoder either;
 * - the same package's **decoder is a hand-ported pure JS module** (`brotli/decompress` →
 *   `dec/decode.js`) and was run inside this realm against bytes produced by Node's own
 *   `zlib.brotliCompressSync`: `"hello brotli realm"` round-tripped byte-exact. So decompression is served for
 *   real, and compression waits for a byte-capable host op (`zlib.brotliCompress` over the handle channel the
 *   v2 fs byte ops establish — bytes do not ride base64 inside the JSON envelope, ADR-0071/§2).
 *
 * Constants are Node's own numbers, read off `require("zlib").constants` (not transcribed from docs).
 */
import BrotliDecompressBuffer from "brotli/decompress"

import { Buffer } from "./buffer.ts"
import { QuickJsShimError, SHIM_ERROR_CODES } from "./host.ts"
import { notImplemented } from "./internal.ts"

export const BROTLI_DECODE = 8
export const BROTLI_ENCODE = 9
export const BROTLI_OPERATION_PROCESS = 0
export const BROTLI_OPERATION_FLUSH = 1
export const BROTLI_OPERATION_FINISH = 2
export const BROTLI_OPERATION_EMIT_METADATA = 3
export const BROTLI_PARAM_MODE = 0
export const BROTLI_MODE_GENERIC = 0
export const BROTLI_MODE_TEXT = 1
export const BROTLI_MODE_FONT = 2
export const BROTLI_DEFAULT_MODE = 0
export const BROTLI_PARAM_QUALITY = 1
export const BROTLI_MIN_QUALITY = 0
export const BROTLI_MAX_QUALITY = 11
export const BROTLI_DEFAULT_QUALITY = 11
export const BROTLI_PARAM_LGWIN = 2
export const BROTLI_MIN_WINDOW_BITS = 10
export const BROTLI_MAX_WINDOW_BITS = 24
export const BROTLI_LARGE_MAX_WINDOW_BITS = 30
export const BROTLI_DEFAULT_WINDOW = 22
export const BROTLI_PARAM_LGBLOCK = 3
export const BROTLI_PARAM_DISABLE_LITERAL_CONTEXT_MODELING = 4
export const BROTLI_PARAM_SIZE_HINT = 5
export const BROTLI_PARAM_LARGE_WINDOW = 6

export const constants = {
  BROTLI_DECODE,
  BROTLI_ENCODE,
  BROTLI_OPERATION_PROCESS,
  BROTLI_OPERATION_FLUSH,
  BROTLI_OPERATION_FINISH,
  BROTLI_OPERATION_EMIT_METADATA,
  BROTLI_PARAM_MODE,
  BROTLI_MODE_GENERIC,
  BROTLI_MODE_TEXT,
  BROTLI_MODE_FONT,
  BROTLI_DEFAULT_MODE,
  BROTLI_PARAM_QUALITY,
  BROTLI_MIN_QUALITY,
  BROTLI_MAX_QUALITY,
  BROTLI_DEFAULT_QUALITY,
  BROTLI_PARAM_LGWIN,
  BROTLI_MIN_WINDOW_BITS,
  BROTLI_MAX_WINDOW_BITS,
  BROTLI_LARGE_MAX_WINDOW_BITS,
  BROTLI_DEFAULT_WINDOW,
  BROTLI_PARAM_LGBLOCK,
  BROTLI_PARAM_DISABLE_LITERAL_CONTEXT_MODELING,
  BROTLI_PARAM_SIZE_HINT,
  BROTLI_PARAM_LARGE_WINDOW,
}

export default { constants }

/** The bytes-to-bytes core the sync and callback shapes share. */
function decodeBrotli(input: unknown): Buffer {
  const bytes = input instanceof Uint8Array ? input : toBytes(input)
  const out = BrotliDecompressBuffer(bytes)
  return Buffer.from(out as Uint8Array)
}

function toBytes(input: unknown): Uint8Array {
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
  if (Array.isArray(input)) return Uint8Array.from(input as number[])
  throw new QuickJsShimError(
    SHIM_ERROR_CODES.signatureUnsupported,
    `zlib.brotliDecompress: unsupported input of type ${typeof input}; pass a Buffer, typed array or ArrayBuffer.`,
  )
}

export function brotliDecompressSync(input: unknown, options?: unknown): Buffer {
  void options
  return decodeBrotli(input)
}

/**
 * Node's callback shape: `(buffer[, options], callback)`. Errors travel through the callback (asynchronously,
 * like Node), never a synchronous throw — `promisify(brotliDecompress)` depends on that split.
 */
export function brotliDecompress(input: unknown, optionsOrCallback?: unknown, callback?: unknown): void | Promise<Buffer> {
  const cb = typeof optionsOrCallback === "function" ? optionsOrCallback : callback
  if (typeof cb !== "function") return Promise.resolve().then(() => decodeBrotli(input))
  try {
    const value = decodeBrotli(input)
    queueMicrotask(() => (cb as (error: Error | null, value?: Buffer) => void)(null, value))
  } catch (error) {
    queueMicrotask(() => (cb as (error: Error | null, value?: Buffer) => void)(error instanceof Error ? error : new Error(String(error))))
  }
  return undefined
}

const ENCODE_OPERATION = "zlib.brotliCompress(bytes) -> bytes over the host handle channel"
const ENCODE_REASON = "the realm has no WebAssembly and the pure-JS brotli encoder is unavailable (measured 2026-10-05)"

export const brotliCompress: (...args: unknown[]) => never = refuseEncode("brotliCompress")
export const brotliCompressSync: (...args: unknown[]) => never = refuseEncode("brotliCompressSync")
export const createBrotliCompress: (...args: unknown[]) => never = refuseEncode("createBrotliCompress")
export const createBrotliDecompress: (...args: unknown[]) => never = notImplemented("zlib", "createBrotliDecompress", "a streaming zlib object needs a host-held descriptor")

function refuseEncode(member: string): (...args: unknown[]) => never {
  return () => {
    throw new QuickJsShimError(SHIM_ERROR_CODES.memberUnsupported, `quickjs-shim: zlib.${member} is not implemented: ${ENCODE_REASON}`, {
      module: "zlib",
      member,
      requiredOperation: ENCODE_OPERATION,
    })
  }
}

/** The gzip/deflate family. No retained node reaches it today; it is refused with the same operation name. */
export const gzip: (...args: unknown[]) => never = notImplemented("zlib", "gzip", ENCODE_OPERATION)
export const gzipSync: (...args: unknown[]) => never = notImplemented("zlib", "gzipSync", ENCODE_OPERATION)
export const gunzip: (...args: unknown[]) => never = notImplemented("zlib", "gunzip", ENCODE_OPERATION)
export const gunzipSync: (...args: unknown[]) => never = notImplemented("zlib", "gunzipSync", ENCODE_OPERATION)
export const deflate: (...args: unknown[]) => never = notImplemented("zlib", "deflate", ENCODE_OPERATION)
export const deflateSync: (...args: unknown[]) => never = notImplemented("zlib", "deflateSync", ENCODE_OPERATION)
export const inflate: (...args: unknown[]) => never = notImplemented("zlib", "inflate", ENCODE_OPERATION)
export const inflateSync: (...args: unknown[]) => never = notImplemented("zlib", "inflateSync", ENCODE_OPERATION)
export const deflateRaw: (...args: unknown[]) => never = notImplemented("zlib", "deflateRaw", ENCODE_OPERATION)
export const deflateRawSync: (...args: unknown[]) => never = notImplemented("zlib", "deflateRawSync", ENCODE_OPERATION)
export const inflateRaw: (...args: unknown[]) => never = notImplemented("zlib", "inflateRaw", ENCODE_OPERATION)
export const inflateRawSync: (...args: unknown[]) => never = notImplemented("zlib", "inflateRawSync", ENCODE_OPERATION)
export const createGzip: (...args: unknown[]) => never = notImplemented("zlib", "createGzip", "a streaming zlib object needs a host-held descriptor")
export const createGunzip: (...args: unknown[]) => never = notImplemented("zlib", "createGunzip", "a streaming zlib object needs a host-held descriptor")
export const createDeflate: (...args: unknown[]) => never = notImplemented("zlib", "createDeflate", "a streaming zlib object needs a host-held descriptor")
export const createInflate: (...args: unknown[]) => never = notImplemented("zlib", "createInflate", "a streaming zlib object needs a host-held descriptor")
