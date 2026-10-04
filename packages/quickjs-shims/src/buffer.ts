/**
 * The `Buffer` global.
 *
 * Not one of the eight `node:` builtins, and it would stay out of this package if the tree did not need it:
 * several platform closures touch `Buffer` directly (`comfygure/project.ts`, `encodeb`, `lorat`, `smartzip`,
 * `coveru`, `repacku`, `enginev`, plus bundled npm behind `logx`). QuickJS has no `Buffer`, so those reads
 * would be `ReferenceError`s that name nothing. The builder installs it as a realm global.
 *
 * Scope, stated rather than pretended: this is a `Uint8Array` carrying Node's constructors and
 * `toString(encoding)` for **utf8, latin1/binary, hex, base64, ascii** only. Everything else — `gb18030`,
 * `ucs2`/`utf16le` — throws a named error: nodes that need a real code page already bundle `iconv-lite` (that
 * is what `encodeb`/`soundw` do), and pure JS is the right place for it — no host round-trip per chunk.
 */
import { bytesFromHostPayload, bytesToBase64, bytesToHex, bytesToLatin1, bytesToUtf8, latin1ToBytes, utf8ToBytes, QuickJsShimError, SHIM_ERROR_CODES } from "./host.ts"
import { notImplemented } from "./internal.ts"

const SUPPORTED_ENCODINGS = ["utf8", "utf-8", "latin1", "binary", "hex", "base64", "ascii"] as const
type SupportedEncoding = (typeof SUPPORTED_ENCODINGS)[number]

function normalizeEncoding(encoding: string | undefined): SupportedEncoding {
  const raw = (encoding ?? "utf8").toLowerCase()
  if (raw === "utf8" || raw === "utf-8") return "utf8"
  if (raw === "latin1" || raw === "binary") return "latin1"
  if (raw === "hex") return "hex"
  if (raw === "base64") return "base64"
  if (raw === "ascii") return "ascii"
  throw new QuickJsShimError(SHIM_ERROR_CODES.signatureUnsupported, `Buffer: encoding ${JSON.stringify(encoding)} is not supported; use iconv-lite (bundled JS) for a real code page.`, { supported: [...SUPPORTED_ENCODINGS] })
}

export class Buffer extends Uint8Array {
  static from(value: unknown, encodingOrOffset?: string | number | ((v: unknown, k: number) => number), maybeLength?: unknown): Buffer {
    if (typeof value === "string") {
      const encoding = normalizeEncoding(typeof encodingOrOffset === "string" ? encodingOrOffset : "utf8")
      return Buffer.fromBytes(stringToBytes(value, encoding))
    }
    if (Array.isArray(value)) return Buffer.fromBytes(Uint8Array.from(value))
    if (value instanceof Uint8Array) return Buffer.fromBytes(value.slice())
    if (value instanceof ArrayBuffer) return Buffer.fromBytes(new Uint8Array(value))
    if (ArrayBuffer.isView(value)) return Buffer.fromBytes(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
    if (value && typeof (value as Iterable<unknown>)[Symbol.iterator] === "function") return Buffer.fromBytes(Uint8Array.from(value as Iterable<number>))
    if (value && typeof (value as ArrayLike<number>).length === "number") return Buffer.fromBytes(Uint8Array.from(Array.from(value as ArrayLike<number>)))
    throw new QuickJsShimError(SHIM_ERROR_CODES.signatureUnsupported, `Buffer.from: unsupported source of type ${typeof value}.`)
  }

  static fromBytes(bytes: Uint8Array): Buffer {
    const buffer = new Buffer(bytes.length)
    buffer.set(bytes)
    return buffer
  }

  static alloc(length: number, fill?: number | string, encoding?: string): Buffer {
    const buffer = new Buffer(Math.max(0, length | 0))
    if (fill === undefined) return buffer
    if (typeof fill === "number") buffer.fill(fill & 0xff)
    else buffer.set(stringToBytes(fill, normalizeEncoding(encoding)).subarray(0, buffer.length))
    return buffer
  }

  static allocUnsafe(length: number): Buffer {
    return new Buffer(Math.max(0, length | 0))
  }
  static allocUnsafeSlow(length: number): Buffer {
    return Buffer.allocUnsafe(length)
  }

  static concat(list: readonly Uint8Array[], totalLength?: number): Buffer {
    const parts = list.map((item) => (item instanceof Buffer ? item : new Uint8Array(item.buffer ?? item, item.byteOffset ?? 0, item.length)))
    const size = totalLength ?? parts.reduce((sum, item) => sum + item.length, 0)
    const out = new Buffer(size)
    let offset = 0
    for (const part of parts) {
      out.set(part.subarray(0, Math.min(part.length, size - offset)), offset)
      offset += part.length
      if (offset >= size) break
    }
    return out
  }

  static byteLength(value: string | Uint8Array | ArrayBuffer, encoding?: string): number {
    if (typeof value === "string") return stringToBytes(value, normalizeEncoding(encoding)).length
    if (value instanceof Uint8Array) return value.length
    if (value instanceof ArrayBuffer) return value.byteLength
    return String(value).length
  }

  static isBuffer(value: unknown): boolean {
    return value instanceof Buffer
  }

  static isEncoding(encoding: string): boolean {
    return (SUPPORTED_ENCODINGS as readonly string[]).includes((encoding ?? "").toLowerCase())
  }

  toString(encoding?: string, start?: number, end?: number): string {
    const slice = this.subarray(start ?? 0, end ?? this.length)
    const kind = normalizeEncoding(encoding)
    switch (kind) {
      case "hex":
        return bytesToHex(slice)
      case "base64":
        return bytesToBase64(slice)
      case "latin1":
      case "ascii":
        return bytesToLatin1(slice)
      case "utf8":
      default:
        return bytesToUtf8(slice)
    }
  }

  // Node returns a Buffer (not a Uint8Array) from these, so they are overridden on the typed-array base.
  override slice(start?: number, end?: number): Buffer {
    return Buffer.fromBytes(super.slice(start, end))
  }
  override subarray(start?: number, end?: number): Buffer {
    return Buffer.fromBytes(super.subarray(start, end))
  }

  includes(search: Uint8Array | number, position = 0): boolean {
    return this.indexOf(search, position) >= 0
  }

  indexOf(search: Uint8Array | number, position = 0): number {
    if (typeof search === "number") return super.indexOf(search & 0xff, position)
    for (let index = position; index <= this.length - search.length; index += 1) {
      let matched = true
      for (let inner = 0; inner < search.length; inner += 1) {
        if (this[index + inner] !== search[inner]) {
          matched = false
          break
        }
      }
      if (matched) return index
    }
    return -1
  }

  copy(target: Uint8Array, targetStart = 0, sourceStart = 0, sourceEnd = this.length): number {
    const chunk = this.subarray(sourceStart, Math.min(sourceEnd, this.length))
    target.set(chunk.subarray(0, Math.min(chunk.length, target.length - targetStart)), targetStart)
    return Math.min(chunk.length, target.length - targetStart)
  }

  equals(other: Uint8Array): boolean {
    if (other.length !== this.length) return false
    for (let index = 0; index < this.length; index += 1) if (this[index] !== other[index]) return false
    return true
  }

  readUInt8(offset = 0): number {
    return this[offset]!
  }
  readUInt16LE(offset = 0): number {
    return this[offset]! | (this[offset + 1]! << 8)
  }
  readUInt16BE(offset = 0): number {
    return (this[offset]! << 8) | this[offset + 1]!
  }
  readUInt32LE(offset = 0): number {
    return (this[offset]! | (this[offset + 1]! << 8) | (this[offset + 2]! << 16)) + this[offset + 3]! * 0x1000000
  }
  readUInt32BE(offset = 0): number {
    return this[offset]! * 0x1000000 + ((this[offset + 1]! << 16) | (this[offset + 2]! << 8) | this[offset + 3]!)
  }
  writeUInt16LE(value: number, offset = 0): number {
    this[offset] = value & 0xff
    this[offset + 1] = (value >> 8) & 0xff
    return offset + 2
  }
  writeUInt32LE(value: number, offset = 0): number {
    this[offset] = value & 0xff
    this[offset + 1] = (value >> 8) & 0xff
    this[offset + 2] = (value >> 16) & 0xff
    this[offset + 3] = (value >>> 24) & 0xff
    return offset + 4
  }
}

function stringToBytes(text: string, encoding: SupportedEncoding): Uint8Array {
  switch (encoding) {
    case "hex":
    case "base64":
      return bytesFromHostPayload(text)
    case "latin1":
    case "ascii":
      return latin1ToBytes(text)
    case "utf8":
    default:
      return utf8ToBytes(text)
  }
}

export const atob: (encoded: string) => string = (encoded) => bytesToLatin1(bytesFromHostPayload(encoded))
export const btoa: (text: string) => string = (text) => bytesToBase64(latin1ToBytes(text))
export const kMaxLength: number = 0x7fffffff

// utf16le/ucs2/gb18030 are intentionally absent (iconv-lite is the right place for a real code page).
export const transpile: () => never = notImplemented("buffer", "transpile")
export const resolveObjectURL: () => never = notImplemented("buffer", "resolveObjectURL", "blob: URLs are not the realm's")

export default { Buffer, atob, btoa, kMaxLength }
