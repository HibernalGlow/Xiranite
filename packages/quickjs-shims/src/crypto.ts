/**
 * `node:crypto` — randomness is the host's, never the realm's.
 *
 * ADR-0074 decision 2: `Math.random()` may not be used for anything a run records, and the undo journal's id
 * suffix already comes from the host. So `randomUUID` and `randomBytes` are the two pinned operations
 * (`crypto.randomUUID`, `crypto.randomBytes`) and nothing in this module derives entropy locally.
 *
 * `createHash` is *not* implementable through operations v1 — hashing is deterministic, but it belongs to the
 * same one-implementation rule (a JS SHA-256 here and Rust's `sha2` in the host would be two implementations of
 * one contract). The measured call sites (comfygure, lorat) are named in the README and the member throws
 * `quickjs-shim: crypto.createHash is not implemented`, asking for `crypto.digest(algorithm, bytes) -> { hex }`.
 * `randomFill` would need a `crypto.randomFill` operation the host does not answer, so it throws too; the node
 * set never calls it (measured).
 */
import { bytesFromHostPayload } from "./host.ts"
import { notImplemented } from "./internal.ts"
import { opRandomBytes, opRandomUUID } from "./ops.ts"

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

export const createHash: (algorithm: string, options?: unknown) => never = notImplemented("crypto", "createHash", "crypto.digest(algorithm, bytes) -> { hex }")
export const createHmac: () => never = notImplemented("crypto", "createHmac")
export const hash: () => never = notImplemented("crypto", "hash", "crypto.digest(algorithm, bytes) -> { hex }")
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
