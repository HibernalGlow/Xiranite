/**
 * `node:string_decoder` — pure TypeScript, no host call.
 *
 * Why it exists: `encodeb` bundles `iconv-lite`, whose internal codecs are thin wrappers over
 * `new StringDecoder(codec.enc)` (`encodings/internal.js:47-51`), and the specifier had no shim module, so the
 * platform bundle kept an unmapped external (gate WARN). `StringDecoder` is self-contained arithmetic over
 * bytes, so it is ported rather than refused.
 *
 * Semantics are pinned by measurement against Node 26 (and re-checked against the live `node:string_decoder`
 * implementation in `string_decoder.test.ts`, including a byte-sequence sweep):
 * - encodings are normalised the way `Buffer` normalises them (`utf-8`/`UTF8` -> `utf8`, `ucs2` -> `utf16le`,
 *   `binary` -> `latin1`) and the instance carries the single own field Node carries: `encoding`;
 * - an unknown encoding throws `TypeError { code: "ERR_UNKNOWN_ENCODING" }` with `Unknown encoding: gb18030`;
 * - `write()` holds back a trailing **incomplete** sequence instead of emitting a replacement character, so a
 *   4-byte code point split 3/1 decodes to `""` then `"😀a"`;
 * - `end()` flushes the held bytes as **one** U+FFFD for utf8, pads the base64 remainder (`0x00` -> `AA==`),
 *   and *drops* an odd trailing byte for `utf16le` (measured: `""`);
 * - invalid utf-8 leads (`0x80`-`0xBF`, `0xC0`, `0xC1`, `0xF5`-`0xFF`) and a rejected second byte (`0xED 0xA0`,
 *   the surrogate range) each cost one U+FFFD and decoding resumes at the next byte, so `ED A0 80` yields three
 *   replacement characters, exactly like Node;
 * - `write(string)` converts with **utf8** regardless of the decoder encoding (Node does `Buffer.from(buf)`),
 *   and `write(null)` throws `ERR_INVALID_ARG_TYPE` naming `buf`;
 * - `ascii` masks the high bit (`0xE9` -> `i`), `latin1` does not (`0xE9` -> `é`); `hex` renders two characters
 *   per byte and never holds.
 *
 * `gb18030`/`cp932`-style code pages are not part of this module: `Buffer` refuses them for the same reason and
 * `encodeb`/`soundw` bundle `iconv-lite`'s own pure-JS codecs, which is where a real code page belongs.
 */
import { bytesToHex, bytesToLatin1, utf8ToBytes } from "./host.ts"

const EMPTY: Uint8Array = new Uint8Array(0)
const REPLACEMENT = "\uFFFD"

type DecodedChunk = { text: string; held: Uint8Array }

function invalidBufferArgument(value: unknown): TypeError {
  const error = new TypeError(
    `The "buf" argument must be an instance of Buffer, TypedArray, or DataView. Received ${describeValue(value)}`,
  ) as TypeError & { code: string }
  error.code = "ERR_INVALID_ARG_TYPE"
  return error
}

function describeValue(value: unknown): string {
  if (value === null) return "null"
  if (value === undefined) return "undefined"
  if (typeof value === "string") return `"${value}"`
  return `type ${typeof value}`
}

const ENCODING_ALIASES: Record<string, string> = {
  "utf8": "utf8",
  "utf-8": "utf8",
  "ucs2": "utf16le",
  "ucs-2": "utf16le",
  "utf16le": "utf16le",
  "utf-16le": "utf16le",
  "latin1": "latin1",
  "binary": "latin1",
  "hex": "hex",
  "base64": "base64",
  "base64url": "base64url",
  "ascii": "ascii",
}

const SUPPORTED_ENCODINGS = ["utf8", "utf16le", "latin1", "ascii", "hex", "base64", "base64url"] as const
type SupportedEncoding = (typeof SUPPORTED_ENCODINGS)[number]

/** Node's `Buffer.isEncoding` normalisation, restricted to what this module can decode. */
function normalizeEncoding(encoding: string | undefined): SupportedEncoding {
  const key = (encoding ?? "utf8").toLowerCase()
  const normalized = ENCODING_ALIASES[key]
  if (normalized === undefined || !(SUPPORTED_ENCODINGS as readonly string[]).includes(normalized)) {
    throw unknownEncoding(encoding)
  }
  return normalized as SupportedEncoding
}

function unknownEncoding(encoding: string | undefined): TypeError {
  const error = new TypeError(`Unknown encoding: ${encoding === undefined ? "undefined" : String(encoding)}`) as TypeError & { code: string }
  error.code = "ERR_UNKNOWN_ENCODING"
  return error
}

/**
 * WHATWG-style UTF-8 decode with one gap over the input: a trailing sequence that is a *valid prefix* is held
 * (returned in `held`) rather than replaced, which is what makes `write()`/`end()` split a code point safely.
 * Every rejected byte costs exactly one U+FFFD and the scan restarts after it, matching Node's counts.
 */
function decodeUtf8(bytes: Uint8Array, holdTrailing: boolean): DecodedChunk {
  let text = ""
  let index = 0
  const end = bytes.length
  while (index < end) {
    const lead = bytes[index]!
    if (lead < 0x80) {
      text += String.fromCharCode(lead)
      index += 1
      continue
    }
    let needed: number
    let secondLow: number
    let secondHigh: number
    if (lead >= 0xc2 && lead <= 0xdf) {
      needed = 1
      secondLow = 0x80
      secondHigh = 0xbf
    } else if (lead === 0xe0) {
      needed = 2
      secondLow = 0xa0
      secondHigh = 0xbf
    } else if (lead === 0xed) {
      needed = 2
      secondLow = 0x80
      secondHigh = 0x9f
    } else if (lead >= 0xe1 && lead <= 0xec || lead === 0xee || lead === 0xef) {
      needed = 2
      secondLow = 0x80
      secondHigh = 0xbf
    } else if (lead === 0xf0) {
      needed = 3
      secondLow = 0x90
      secondHigh = 0xbf
    } else if (lead === 0xf4) {
      needed = 3
      secondLow = 0x80
      secondHigh = 0x8f
    } else if (lead === 0xf1 || lead === 0xf2 || lead === 0xf3) {
      needed = 3
      secondLow = 0x80
      secondHigh = 0xbf
    } else {
      text += REPLACEMENT
      index += 1
      continue
    }
    let status: "complete" | "prefix" | "invalid" = "complete"
    for (let offset = 1; offset <= needed; offset += 1) {
      const position = index + offset
      if (position >= end) {
        status = "prefix"
        break
      }
      const continuation = bytes[position]!
      const low = offset === 1 ? secondLow : 0x80
      const high = offset === 1 ? secondHigh : 0xbf
      if (continuation < low || continuation > high) {
        status = "invalid"
        break
      }
    }
    if (status === "prefix") {
      if (holdTrailing) return { text, held: bytes.subarray(index) }
      return { text: text + REPLACEMENT, held: EMPTY }
    }
    if (status === "invalid") {
      text += REPLACEMENT
      index += 1
      continue
    }
    const codePoint =
      needed === 1 ? ((lead & 0x1f) << 6) | bytes[index + 1]! & 0x3f : needed === 2 ? ((lead & 0x0f) << 12) | ((bytes[index + 1]! & 0x3f) << 6) | (bytes[index + 2]! & 0x3f) : ((lead & 0x07) << 18) | ((bytes[index + 1]! & 0x3f) << 12) | ((bytes[index + 2]! & 0x3f) << 6) | (bytes[index + 3]! & 0x3f)
    text += String.fromCodePoint(codePoint)
    index += needed + 1
  }
  return { text, held: EMPTY }
}

/** UTF-16LE: pairs of bytes, an odd trailing byte held; on flush Node drops it (measured `""`). */
function decodeUtf16Le(bytes: Uint8Array, holdTrailing: boolean): DecodedChunk {
  const usable = bytes.length - (bytes.length % 2)
  let text = ""
  for (let index = 0; index + 1 < bytes.length; index += 2) text += String.fromCharCode(bytes[index]! | (bytes[index + 1]! << 8))
  // A flush drops an odd trailing byte outright rather than replacing it, which is what the loop already does.
  return { text, held: holdTrailing ? bytes.subarray(usable) : EMPTY }
}

/** Base64: three bytes become four characters; the remainder is held and padded on flush. */
function decodeBase64(bytes: Uint8Array, holdTrailing: boolean, urlSafe: boolean): DecodedChunk {
  const usable = bytes.length - (bytes.length % 3)
  const text = encodeBase64Group(bytes.subarray(0, usable), urlSafe)
  return { text, held: holdTrailing ? bytes.subarray(usable) : EMPTY }
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"

function encodeBase64Group(bytes: Uint8Array, urlSafe: boolean): string {
  const alphabet = urlSafe ? BASE64URL_ALPHABET : BASE64_ALPHABET
  let output = ""
  for (let index = 0; index + 2 < bytes.length; index += 3) {
    const value = (bytes[index]! << 16) | (bytes[index + 1]! << 8) | bytes[index + 2]!
    output += alphabet[(value >> 18) & 0x3f] + alphabet[(value >> 12) & 0x3f] + alphabet[(value >> 6) & 0x3f] + alphabet[value & 0x3f]
  }
  const remainder = bytes.length % 3
  if (remainder === 1) {
    const value = bytes[bytes.length - 1]! << 16
    output += alphabet[(value >> 18) & 0x3f] + alphabet[(value >> 12) & 0x3f] + (urlSafe ? "" : "==")
  } else if (remainder === 2) {
    const value = (bytes[bytes.length - 2]! << 16) | (bytes[bytes.length - 1]! << 8)
    output += alphabet[(value >> 18) & 0x3f] + alphabet[(value >> 12) & 0x3f] + alphabet[(value >> 6) & 0x3f] + (urlSafe ? "" : "=")
  }
  return output
}

function decodeAsciiMasked(bytes: Uint8Array): DecodedChunk {
  let text = ""
  for (const byte of bytes) text += String.fromCharCode(byte & 0x7f)
  return { text, held: EMPTY }
}

export class StringDecoder {
  /** The one own field Node's decoder carries, in its normalised spelling. */
  readonly encoding: SupportedEncoding

  private held: Uint8Array = EMPTY

  constructor(encoding?: string) {
    this.encoding = normalizeEncoding(encoding)
  }

  write(value: Uint8Array | string): string {
    const bytes = toBytes(value)
    if (bytes.length === 0) return ""
    const joined = this.held.length === 0 ? bytes : concatBytes(this.held, bytes)
    const decoded = this.decode(joined, true)
    this.held = decoded.held
    return decoded.text
  }

  /** Node's `end(buf)` writes `buf` first, then flushes whatever is held. */
  end(value?: Uint8Array | string): string {
    if (value !== null && value !== undefined) {
      const text = this.write(value)
      const flushed = this.decode(this.held, false)
      this.held = EMPTY
      return text + flushed.text
    }
    const flushed = this.decode(this.held, false)
    this.held = EMPTY
    return flushed.text
  }

  /** Node's `text(buf, offset)`: drop the held bytes and decode the rest — no state carried across. */
  text(value: Uint8Array | string, offset = 0): string {
    const bytes = toBytes(value)
    this.held = EMPTY
    return this.decode(bytes.subarray(offset), true).text
  }

  private decode(bytes: Uint8Array, holdTrailing: boolean): DecodedChunk {
    switch (this.encoding) {
      case "utf8":
        return decodeUtf8(bytes, holdTrailing)
      case "utf16le":
        return decodeUtf16Le(bytes, holdTrailing)
      case "base64":
      case "base64url":
        return decodeBase64(bytes, holdTrailing, this.encoding === "base64url")
      case "latin1":
        return { text: bytesToLatin1(bytes), held: EMPTY }
      case "ascii":
        return decodeAsciiMasked(bytes)
      case "hex":
        return { text: bytesToHex(bytes), held: EMPTY }
    }
  }
}

/**
 * Node converts a `string` argument with `Buffer.from(buf)`, i.e. as UTF-8, whatever the decoder encoding is;
 * a number or `null` is rejected by name. Nothing here reaches for the machine.
 */
function toBytes(value: unknown): Uint8Array {
  if (typeof value === "string") return utf8ToBytes(value)
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
  }
  throw invalidBufferArgument(value)
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const out = new Uint8Array(left.length + right.length)
  out.set(left)
  out.set(right, left.length)
  return out
}

const namespace = { StringDecoder }
export default namespace
