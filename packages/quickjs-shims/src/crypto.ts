/**
 * `node:crypto` — randomness is the host's, never the realm's.
 *
 * ADR-0074 decision 2: `Math.random()` may not be used for anything a run records, and the undo journal's id
 * suffix already comes from the host. So `randomUUID` and `randomBytes` are the two pinned operations
 * (`crypto.randomUUID`, `crypto.randomBytes`) and nothing in this module derives entropy locally.
 *
 * `createHash`/`hash` are implementable and are: the realm buffers the bytes and asks the host's `crypto.digest`
 * (its own `sha1`/`sha2`), so there is exactly one implementation per algorithm — which was always the reason the
 * member refused rather than a lack of an operation (ADR-0074 §2). Measured callers: comfygure, lorat.
 * `createHmac`, the cipher/sign/scrypt family and `randomFill` still throw: the host answers none of them.
 */
import { Buffer } from "./buffer.ts"
import { QuickJsShimError, SHIM_ERROR_CODES, bytesFromHostPayload } from "./host.ts"
import { notImplemented } from "./internal.ts"
import { opCryptoDigest, opRandomBytes, opRandomUUID } from "./ops.ts"

export function randomUUID(): string {
  return opRandomUUID()
}

/** Node's `randomBytes` result is a Buffer; the realm hands back a Uint8Array with the same reads. */
export function randomBytes(length: number): Uint8Array {
  if (!Number.isInteger(length) || length < 0) {
    throw new RangeError(`crypto.randomBytes: length must be a non-negative integer, received ${String(length)}`)
  }
  return bytesFromHostPayload(opRandomBytes(length), length)
}

/**
 * Node's `crypto.createHash(algorithm)` — the bytes are buffered here, the hash is answered by the host.
 *
 * SHA is a function of the byte stream, so accumulating `update()` calls and asking `crypto.digest` once is the
 * same computation as Node's incremental hashing, with the same single implementation (Rust's `sha1`/`sha2`),
 * which is the whole point: a JS SHA sitting next to the host's would be two implementations of one contract.
 * The host names the algorithms it answers when it refuses one (`host_calls.rs:374-379`), so `md5`/`sha512` fail
 * loudly rather than being quietly downgraded.
 *
 * Two stated differences from Node, neither of which any measured call site depends on: a realm hash has no
 * `copy()`/`setTransform()` and no stream form, and calling `digest()` twice answers the same bytes instead of
 * rejecting the second call.
 */
export function createHash(algorithm: string, options?: unknown): HashLike {
  if (typeof algorithm !== "string" || algorithm.trim() === "") {
    throw new TypeError(`crypto.createHash: algorithm must be a non-empty string, received ${String(algorithm)}`)
  }
  if (options !== undefined) {
    throw new QuickJsShimError(SHIM_ERROR_CODES.signatureUnsupported, "crypto.createHash: the options stream (outputFormat/allowUnsafeLegacy) has no realm form.")
  }
  return new RealmHash(algorithm)
}

interface HashLike {
  update(data: unknown, inputEncoding?: string): HashLike
  digest(outputEncoding?: string): Buffer | string
}

class RealmHash implements HashLike {
  readonly algorithm: string
  private chunks: Uint8Array[] = []
  private byteLength = 0
  private digested = false

  constructor(algorithm: string) {
    this.algorithm = algorithm
  }

  update(data: unknown, inputEncoding?: string): this {
    if (this.digested) throw new Error("crypto.createHash: hash.update after digest is not supported.")
    const bytes = hashInputToBytes(data, inputEncoding)
    this.chunks.push(bytes)
    this.byteLength += bytes.length
    return this
  }

  digest(outputEncoding?: string): Buffer | string {
    // One host call over the concatenated stream; the buffer is built without a second copy of the whole file.
    const joined = new Uint8Array(this.byteLength)
    let offset = 0
    for (const chunk of this.chunks) {
      joined.set(chunk, offset)
      offset += chunk.length
    }
    const result = opCryptoDigest(this.algorithm, joined)
    this.digested = true
    return hexToOutput(result.hex, outputEncoding)
  }
}

function hashInputToBytes(data: unknown, inputEncoding?: string): Uint8Array {
  if (data instanceof Uint8Array) return data
  if (typeof data === "string") return Buffer.from(data, (inputEncoding ?? "utf8") as never)
  throw new TypeError(`crypto: the data argument must be a string, Buffer or TypedArray, received ${data === null ? "null" : typeof data}.`)
}

/** `crypto.digest` answers lowercase hex; the output encoding is Node's, so `Buffer` renders it, not a hand codec. */
function hexToOutput(hex: string, outputEncoding?: string): Buffer | string {
  const bytes = Buffer.from(hex, "hex")
  if (outputEncoding === undefined || outputEncoding === "buffer") return bytes
  return bytes.toString(outputEncoding as never)
}

/**
 * Node's one-shot `crypto.hash(algorithm, data[, options])` — same single host implementation, same refusal of an
 * algorithm the host does not name.
 */
export function hash(algorithm: string, data: unknown, options?: { outputEncoding?: string } | string): Buffer | string {
  const encoding = typeof options === "string" ? options : options?.outputEncoding
  return hexToOutput(opCryptoDigest(algorithm, hashInputToBytes(data, undefined)).hex, encoding)
}

export const createHmac: () => never = notImplemented("crypto", "createHmac", "a host-side HMAC service (the host answers sha1/sha256 digests, not keyed ones)")
export const randomFill: () => never = notImplemented("crypto", "randomFill", "crypto.randomFill(byteLength) -> bytes")
export const randomFillSync: () => never = notImplemented("crypto", "randomFillSync", "crypto.randomFill(byteLength) -> bytes")

/** The host's entropy ceiling (`MAX_RANDOM_BYTES` in `crates/xiranite-quickjs-executor/src/host_calls.rs`). */
const HOST_RANDOM_CEILING = 64

/**
 * WebCrypto's `getRandomValues(buffer)`, filled from the host's `crypto.randomBytes`.
 *
 * It is implementable through the existing operation (unlike `randomFill`, which would need the host to
 * answer a byte *channel* the realm cannot reach), and the global `crypto` object needs it: retained nodes
 * call `crypto.randomUUID()` bare, so the prelude installs this namespace as a realm global. A fill larger
 * than the host's ceiling is refused rather than silently half-filled.
 */
export function getRandomValues<T extends ArrayBufferView | null>(target: T): T {
  if (target === null || target === undefined) return target
  const bytes = new Uint8Array(target.buffer as ArrayBuffer, (target as { byteOffset?: number }).byteOffset ?? 0, target.byteLength)
  if (bytes.length > HOST_RANDOM_CEILING) {
    throw new RangeError(
      `crypto.getRandomValues: ${String(bytes.length)} bytes exceeds the host's ${String(HOST_RANDOM_CEILING)}-byte entropy ceiling; ask the host for crypto.randomFill(byteLength) -> bytes`,
    )
  }
  bytes.set(randomBytes(bytes.length))
  return target
}

/**
 * The realm's `crypto` global, as `installShimGlobals` installs it.
 *
 * The subset the host can actually answer. `digest`/`subtle` are deliberately absent: a missing member
 * throws `ReferenceError` at the call site, which is a found bug, while a locally-implemented hash would
 * be a second implementation of `crypto.digest` and would drift silently (ADR-0074 §2).
 */
export function createCryptoGlobal(): { randomUUID: () => string; getRandomValues: typeof getRandomValues } {
  return { randomUUID, getRandomValues }
}
export const randomInt: () => never = notImplemented("crypto", "randomInt")
export const timingSafeEqual: () => never = notImplemented("crypto", "timingSafeEqual")
export const createCipheriv: () => never = notImplemented("crypto", "createCipheriv")
export const createDecipheriv: () => never = notImplemented("crypto", "createDecipheriv")
export const createSign: () => never = notImplemented("crypto", "createSign")
export const createVerify: () => never = notImplemented("crypto", "createVerify")
export const pbkdf2: () => never = notImplemented("crypto", "pbkdf2")
export const pbkdf2Sync: () => never = notImplemented("crypto", "pbkdf2Sync")
export const scrypt: () => never = notImplemented("crypto", "scrypt")
export const scryptSync: () => never = notImplemented("crypto", "scryptSync")

const namespace = {
  randomUUID, randomBytes, createHash, createHmac, hash, randomFill, randomFillSync, getRandomValues, randomInt,
  timingSafeEqual, createCipheriv, createDecipheriv, createSign, createVerify, pbkdf2, pbkdf2Sync, scrypt, scryptSync,
}
export default namespace
