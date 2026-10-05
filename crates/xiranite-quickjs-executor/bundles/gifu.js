var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// packages/quickjs-shims/src/host.ts
var HOST_GLOBAL_KEY = "__xrh";
var SHIM_ERROR_CODES = {
  /** `__xrh` was never installed: the bundle is running outside the QuickJS host. */
  hostMissing: "quickjs-shim-host-missing",
  /** The member exists in Node but this shim does not implement it (see README). */
  memberUnsupported: "quickjs-shim-member-unsupported",
  /** The shim called an operation the host does not serve (operations v1 is a closed list). */
  operationUnsupported: "quickjs-shim-operation-unsupported",
  /** The host answered with an error object / threw. */
  hostRejected: "quickjs-shim-host-rejected",
  /** The host answered, but not with the shape this protocol pins. */
  hostResultInvalid: "quickjs-shim-host-result-invalid",
  /** A Node signature this shim cannot honour (a non-utf8 `encoding`, a binary `Buffer` payload, ...). */
  signatureUnsupported: "quickjs-shim-signature-unsupported"
};
var QuickJsShimError = class extends Error {
  code;
  details;
  constructor(code, message, details) {
    super(message);
    this.name = "QuickJsShimError";
    this.code = code;
    if (details !== void 0) this.details = details;
  }
};
var OPERATIONS_V1 = [
  "fs.stat",
  "fs.list",
  "fs.readText",
  "fs.writeText",
  "fs.ensureDir",
  "fs.move",
  "fs.delete",
  "proc.exec",
  "clock.now",
  "crypto.randomUUID",
  "crypto.randomBytes",
  "os.tmpdir",
  "os.homedir",
  // The one door to a host service. Its own arguments carry the domain vocabulary
  // (`{ service, method, args }`), so a node's engine never adds members to this list.
  "service.invoke"
];
var OPERATIONS_V2_REQUESTED = [
  "fs.readBytes(path, {offset?, length?}) -> ArrayBuffer   // binary file content; NOT base64-in-JSON",
  "fs.writeBytes(path, bytes, { mode?, append? }) -> null  // binary write",
  "fs.appendText(path, text) -> null                        // appendFile without a full read/rewrite",
  "fs.copy(source, target, { recursive?, force? }) -> null  // copyFile / cp",
  "fs.mkdtemp(prefix) -> path                               // mkdtemp / mkdtempSync",
  "fs.link(source, target) / fs.symlink(target, path, type) / fs.readlink(path)",
  "fs.realpath(path) -> path",
  "fs.utimes(path, atimeMs, mtimeMs)",
  "fs.stat should also answer { sizeBytes, mtimeMs, atimeMs, ctimeMs, birthtimeMs } (timeu/synct/enginev)",
  "crypto.digest(algorithm, bytes) -> { hex }               // createHash; host already carries sha2",
  "proc.spawn(program, args, { cwd }) -> handle             // spawn / spawnSync live process handle"
];
function host() {
  const candidate = globalThis[HOST_GLOBAL_KEY];
  if (candidate === void 0 || candidate === null || typeof candidate.call !== "function" || typeof candidate.platform !== "object" || candidate.platform === null) {
    throw new QuickJsShimError(
      SHIM_ERROR_CODES.hostMissing,
      `globalThis.${HOST_GLOBAL_KEY} is not installed: these shims only run inside the Xiranite QuickJS host.`,
      { expected: ["call", "callAsync", "now", "platform"] }
    );
  }
  return candidate;
}
function hasHost() {
  const candidate = globalThis[HOST_GLOBAL_KEY];
  return candidate !== void 0 && candidate !== null && typeof candidate.call === "function" && typeof candidate.platform === "object";
}
var FALLBACK_PLATFORM_INFO = { platform: "linux", arch: "unknown", sep: "/", pathSep: ":", cwd: "/", env: "{}" };
var cachedPlatform;
var cachedEnv;
function platformInfo() {
  cachedPlatform ??= host().platform;
  return cachedPlatform;
}
function platformInfoOrFallback() {
  return hasHost() ? platformInfo() : FALLBACK_PLATFORM_INFO;
}
function isWindows() {
  return platformInfo().platform === "win32";
}
function hostEnv() {
  if (cachedEnv !== void 0) return cachedEnv;
  const raw = platformInfo().env;
  if (typeof raw !== "string" || raw.length === 0) {
    cachedEnv = {};
    return cachedEnv;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new QuickJsShimError(SHIM_ERROR_CODES.hostResultInvalid, `__xrh.platform.env is not valid JSON: ${String(cause)}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new QuickJsShimError(SHIM_ERROR_CODES.hostResultInvalid, "__xrh.platform.env must be a JSON object.");
  }
  const out = {};
  for (const [key, value] of Object.entries(parsed)) {
    out[key] = value === null || value === void 0 ? "" : String(value);
  }
  cachedEnv = out;
  return out;
}
function unsupportedOperation(op, why) {
  return new QuickJsShimError(
    SHIM_ERROR_CODES.operationUnsupported,
    `the host does not serve operation ${JSON.stringify(op)} (${why}). Operations v1 are: ${OPERATIONS_V1.join(" ")}.`,
    { operation: op, requested: [...OPERATIONS_V2_REQUESTED] }
  );
}
function decodeHostResult(op, raw) {
  if (raw === "__UNSUPPORTED__") throw unsupportedOperation(op, "the host answered __UNSUPPORTED__");
  let payload;
  try {
    payload = raw.length === 0 ? null : JSON.parse(raw);
  } catch (cause) {
    throw new QuickJsShimError(SHIM_ERROR_CODES.hostResultInvalid, `host operation ${op} returned a body that is not valid JSON: ${String(cause)}`);
  }
  if (payload !== null && typeof payload === "object" && !Array.isArray(payload)) {
    const record = payload;
    if (record["ok"] === false) {
      const message = typeof record["message"] === "string" ? record["message"] : JSON.stringify(payload);
      throw new QuickJsShimError(SHIM_ERROR_CODES.hostRejected, `host operation ${op} failed: ${message}`, { operation: op, details: record });
    }
    if (record["ok"] === true && "value" in record) return record["value"];
  }
  return payload;
}
function asShimError(op, cause) {
  if (cause instanceof QuickJsShimError) return cause;
  const message = cause instanceof Error ? cause.message : String(cause);
  if (/unknown host operation|unsupported|not implemented/i.test(message)) return unsupportedOperation(op, message);
  return new QuickJsShimError(SHIM_ERROR_CODES.hostRejected, `host operation ${op} threw: ${message}`, { operation: op });
}
function hostCall(op, args) {
  let raw;
  try {
    raw = host().call(op, JSON.stringify(args ?? {}));
  } catch (cause) {
    throw asShimError(op, cause);
  }
  return decodeHostResult(op, raw);
}
async function hostCallAsync(op, args) {
  const h = host();
  if (typeof h.callAsync === "function") {
    let raw;
    try {
      raw = await h.callAsync(op, JSON.stringify(args ?? {}));
    } catch (cause) {
      throw asShimError(op, cause);
    }
    return decodeHostResult(op, raw);
  }
  return hostCall(op, args);
}
var BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function hexToBytes(value) {
  const clean2 = value.length % 2 === 0 ? value : value.slice(0, value.length - 1);
  const out = new Uint8Array(Math.floor(clean2.length / 2));
  for (let index = 0; index < out.length; index += 1) {
    const byte = Number.parseInt(clean2.slice(index * 2, index * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new QuickJsShimError(SHIM_ERROR_CODES.hostResultInvalid, `host returned a non-hex byte string: ${JSON.stringify(value)}`);
    }
    out[index] = byte;
  }
  return out;
}
function base64ToBytes(value) {
  const normalized = value.replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor(normalized.length * 3 / 4));
  let buffer = 0;
  let bits = 0;
  let written = 0;
  for (const character of normalized) {
    const index = BASE64_ALPHABET.indexOf(character);
    if (index < 0) continue;
    buffer = buffer << 6 | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[written] = buffer >> bits & 255;
      written += 1;
    }
  }
  return written === out.length ? out : out.subarray(0, written);
}
function bytesFromHostPayload(value, expectedLength) {
  let bytes;
  if (typeof value === "string") bytes = /[^0-9a-fA-F]/.test(value) || value.length % 2 !== 0 ? base64ToBytes(value) : hexToBytes(value);
  else if (value instanceof Uint8Array) bytes = value;
  else if (Array.isArray(value) && value.every((item) => typeof item === "number")) bytes = Uint8Array.from(value);
  else if (value !== null && typeof value === "object") {
    const record = value;
    if (typeof record["hex"] === "string") bytes = hexToBytes(record["hex"]);
    else if (typeof record["base64"] === "string") bytes = base64ToBytes(record["base64"]);
    else throw new QuickJsShimError(SHIM_ERROR_CODES.hostResultInvalid, "host byte result must carry `hex` or `base64`.");
  } else throw new QuickJsShimError(SHIM_ERROR_CODES.hostResultInvalid, `host byte result has an unusable type: ${typeof value}`);
  if (expectedLength !== void 0 && bytes.length !== expectedLength) {
    throw new QuickJsShimError(SHIM_ERROR_CODES.hostResultInvalid, `host returned ${bytes.length} byte(s) where ${expectedLength} were requested.`, {
      requested: expectedLength,
      received: bytes.length
    });
  }
  return bytes;
}
function bytesToUtf8(bytes) {
  let output = "";
  let index = 0;
  const end = bytes.length;
  while (index < end) {
    const first2 = bytes[index];
    if (first2 < 128) {
      output += String.fromCharCode(first2);
      index += 1;
      continue;
    }
    let codePoint;
    if ((first2 & 224) === 192) {
      codePoint = (first2 & 31) << 6 | bytes[index + 1] & 63;
      index += 2;
    } else if ((first2 & 240) === 224) {
      codePoint = (first2 & 15) << 12 | (bytes[index + 1] & 63) << 6 | bytes[index + 2] & 63;
      index += 3;
    } else {
      codePoint = (first2 & 7) << 18 | (bytes[index + 1] & 63) << 12 | (bytes[index + 2] & 63) << 6 | bytes[index + 3] & 63;
      index += 4;
    }
    if (codePoint >= 65536) {
      const offset = codePoint - 65536;
      output += String.fromCharCode(55296 + (offset >> 10), 56320 + (offset & 1023));
    } else {
      output += String.fromCharCode(codePoint);
    }
  }
  return output;
}
function utf8ToBytes(text) {
  const out = [];
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (codePoint < 128) out.push(codePoint);
    else if (codePoint < 2048) out.push(192 | codePoint >> 6, 128 | codePoint & 63);
    else if (codePoint < 65536) out.push(224 | codePoint >> 12, 128 | codePoint >> 6 & 63, 128 | codePoint & 63);
    else out.push(240 | codePoint >> 18, 128 | codePoint >> 12 & 63, 128 | codePoint >> 6 & 63, 128 | codePoint & 63);
  }
  return Uint8Array.from(out);
}
function bytesToLatin1(bytes) {
  let output = "";
  for (const byte of bytes) output += String.fromCharCode(byte);
  return output;
}
function latin1ToBytes(text) {
  const out = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) out[index] = text.charCodeAt(index) & 255;
  return out;
}
function bytesToHex(bytes) {
  let output = "";
  for (const byte of bytes) output += byte.toString(16).padStart(2, "0");
  return output;
}
function bytesToBase64(bytes) {
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const chunk = bytes.subarray(index, Math.min(index + 3, bytes.length));
    const value = chunk[0] << 16 | (chunk[1] ?? 0) << 8 | (chunk[2] ?? 0);
    output += BASE64_ALPHABET[value >> 18 & 63];
    output += BASE64_ALPHABET[value >> 12 & 63];
    output += chunk.length > 1 ? BASE64_ALPHABET[value >> 6 & 63] : "=";
    output += chunk.length > 2 ? BASE64_ALPHABET[value & 63] : "=";
  }
  return output;
}

// packages/quickjs-shims/src/internal.ts
function notImplementedMessage(module, member) {
  return `quickjs-shim: ${module}.${member} is not implemented`;
}
function notImplemented(module, member, requiredOperation) {
  return () => {
    throw new QuickJsShimError(
      SHIM_ERROR_CODES.memberUnsupported,
      notImplementedMessage(module, member),
      requiredOperation === void 0 ? { module, member } : { module, member, requiredOperation }
    );
  };
}
var QuickJSStats = class _QuickJSStats {
  size;
  mode;
  mtimeMs;
  atimeMs;
  ctimeMs;
  birthtimeMs;
  kind;
  constructor(payload) {
    if (payload === null || typeof payload !== "object") {
      throw new QuickJsShimError(SHIM_ERROR_CODES.hostResultInvalid, `host fs.stat returned an unusable payload: ${JSON.stringify(payload)}`);
    }
    this.kind = statKind(payload);
    this.size = numberOr(payload.sizeBytes ?? payload.size, 0);
    this.mode = numberOr(payload.mode, defaultModeFor(this.kind));
    this.mtimeMs = numberOr(payload.mtimeMs, 0);
    this.atimeMs = numberOr(payload.atimeMs, this.mtimeMs);
    this.ctimeMs = numberOr(payload.ctimeMs, this.mtimeMs);
    this.birthtimeMs = numberOr(payload.birthtimeMs, this.ctimeMs);
  }
  isFile() {
    return this.kind === "file";
  }
  isDirectory() {
    return this.kind === "dir";
  }
  isSymbolicLink() {
    return this.kind === "symlink";
  }
  isBlockDevice() {
    return false;
  }
  isCharacterDevice() {
    return false;
  }
  isFIFO() {
    return false;
  }
  isSocket() {
    return false;
  }
  /**
   * `mtime`/`atime`/`ctime`/`birthtime` are `Date` properties in Node, not methods. Nodes that compare or
   * restore file times read them directly, so the instance carries both the `*Ms` number and the `Date`.
   */
  static from(payload) {
    const stats = new _QuickJSStats(payload);
    const stamped = stats;
    defineDate(stamped, "mtime", stats.mtimeMs);
    defineDate(stamped, "atime", stats.atimeMs);
    defineDate(stamped, "ctime", stats.ctimeMs);
    defineDate(stamped, "birthtime", stats.birthtimeMs);
    return stamped;
  }
};
function defineDate(target, key, ms) {
  Object.defineProperty(target, key, { value: new Date(ms), enumerable: true, configurable: true });
}
function numberOr(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function defaultModeFor(kind) {
  return kind === "dir" ? 16877 : 33188;
}
function statKind(payload) {
  if (typeof payload.kind === "string") return payload.kind;
  if (payload.isSymlink === true) return "symlink";
  if (payload.isDirectory === true) return "dir";
  if (payload.isFile === true) return "file";
  return "other";
}
var QuickJSDirent = class {
  name;
  kind;
  constructor(entry) {
    this.name = entry.name;
    this.kind = entryKind(entry);
  }
  isFile() {
    return this.kind === "file";
  }
  isDirectory() {
    return this.kind === "dir";
  }
  isSymbolicLink() {
    return this.kind === "symlink";
  }
  isBlockDevice() {
    return false;
  }
  isCharacterDevice() {
    return false;
  }
  isFIFO() {
    return false;
  }
  isSocket() {
    return false;
  }
};
function entryKind(entry) {
  if (typeof entry.kind === "string") return entry.kind;
  if (entry.isDirectory === true) return "dir";
  if (entry.isFile === true) return "file";
  return "other";
}
function toPathString(value, context) {
  if (typeof value === "string") return value;
  if (isUrlLike(value)) {
    const url = value;
    if (url.protocol !== "file:") {
      throw new QuickJsShimError(
        SHIM_ERROR_CODES.signatureUnsupported,
        `${context}: only file: URLs can name a path for the host filesystem, got ${JSON.stringify(url.protocol)}`
      );
    }
    return fileUrlToPath(url.href);
  }
  if (value instanceof Uint8Array) return bytesToUtf8(value);
  if (typeof value === "number" && Number.isInteger(value)) {
    throw new QuickJsShimError(SHIM_ERROR_CODES.signatureUnsupported, `${context}: numeric file descriptors are not supported by the host filesystem API.`);
  }
  throw new QuickJsShimError(SHIM_ERROR_CODES.signatureUnsupported, `${context}: unsupported path argument of type ${typeof value}.`);
}
function isUrlLike(value) {
  return typeof value === "object" && value !== null && "href" in value && "protocol" in value;
}
function fileUrlToPath(href) {
  let withoutScheme = href.slice("file://".length);
  if (withoutScheme.startsWith("localhost/")) withoutScheme = withoutScheme.slice("localhost".length);
  const queryIndex = withoutScheme.search(/[?#]/);
  if (queryIndex >= 0) withoutScheme = withoutScheme.slice(0, queryIndex);
  let decoded = decodeURIComponent(withoutScheme);
  const windows = hostIsWindows();
  if (windows) {
    if (/^\/[A-Za-z]:/.test(decoded)) decoded = decoded.slice(1);
    if (!decoded.startsWith("\\") && decoded.startsWith("//")) decoded = decoded.replace(/^\/\//, "\\\\");
  }
  return decoded.replace(/\//g, windows ? "\\" : "/");
}
function hostIsWindows() {
  try {
    return isWindows();
  } catch {
    return false;
  }
}
function normalizeEncodingOption(value) {
  if (value === null || value === void 0) return { encoding: void 0, options: {} };
  if (typeof value === "string") return { encoding: value, options: {} };
  if (typeof value === "object") {
    const record = value;
    return { encoding: typeof record["encoding"] === "string" ? record["encoding"] : void 0, options: record };
  }
  throw new QuickJsShimError(SHIM_ERROR_CODES.signatureUnsupported, `unsupported options argument of type ${typeof value}.`);
}
function withCallback(promise, callback) {
  if (typeof callback !== "function") return promise;
  promise.then(
    (value) => callback(null, value),
    (error) => callback(error instanceof Error ? error : new Error(String(error)))
  );
  return void 0;
}

// packages/quickjs-shims/src/buffer.ts
var SUPPORTED_ENCODINGS = ["utf8", "utf-8", "latin1", "binary", "hex", "base64", "ascii"];
function normalizeEncoding(encoding) {
  const raw = (encoding ?? "utf8").toLowerCase();
  if (raw === "utf8" || raw === "utf-8") return "utf8";
  if (raw === "latin1" || raw === "binary") return "latin1";
  if (raw === "hex") return "hex";
  if (raw === "base64") return "base64";
  if (raw === "ascii") return "ascii";
  throw new QuickJsShimError(SHIM_ERROR_CODES.signatureUnsupported, `Buffer: encoding ${JSON.stringify(encoding)} is not supported; use iconv-lite (bundled JS) for a real code page.`, { supported: [...SUPPORTED_ENCODINGS] });
}
var Buffer2 = class _Buffer extends Uint8Array {
  static from(value, encodingOrOffset, maybeLength) {
    if (typeof value === "string") {
      const encoding = normalizeEncoding(typeof encodingOrOffset === "string" ? encodingOrOffset : "utf8");
      return _Buffer.fromBytes(stringToBytes(value, encoding));
    }
    if (Array.isArray(value)) return _Buffer.fromBytes(Uint8Array.from(value));
    if (value instanceof Uint8Array) return _Buffer.fromBytes(value.slice());
    if (value instanceof ArrayBuffer) return _Buffer.fromBytes(new Uint8Array(value));
    if (ArrayBuffer.isView(value)) return _Buffer.fromBytes(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    if (value && typeof value[Symbol.iterator] === "function") return _Buffer.fromBytes(Uint8Array.from(value));
    if (value && typeof value.length === "number") return _Buffer.fromBytes(Uint8Array.from(Array.from(value)));
    throw new QuickJsShimError(SHIM_ERROR_CODES.signatureUnsupported, `Buffer.from: unsupported source of type ${typeof value}.`);
  }
  static fromBytes(bytes) {
    const buffer = new _Buffer(bytes.length);
    buffer.set(bytes);
    return buffer;
  }
  static alloc(length, fill, encoding) {
    const buffer = new _Buffer(Math.max(0, length | 0));
    if (fill === void 0) return buffer;
    if (typeof fill === "number") buffer.fill(fill & 255);
    else buffer.set(stringToBytes(fill, normalizeEncoding(encoding)).subarray(0, buffer.length));
    return buffer;
  }
  static allocUnsafe(length) {
    return new _Buffer(Math.max(0, length | 0));
  }
  static allocUnsafeSlow(length) {
    return _Buffer.allocUnsafe(length);
  }
  static concat(list, totalLength) {
    const parts = list.map((item) => item instanceof _Buffer ? item : new Uint8Array(item.buffer ?? item, item.byteOffset ?? 0, item.length));
    const size = totalLength ?? parts.reduce((sum, item) => sum + item.length, 0);
    const out = new _Buffer(size);
    let offset = 0;
    for (const part of parts) {
      out.set(part.subarray(0, Math.min(part.length, size - offset)), offset);
      offset += part.length;
      if (offset >= size) break;
    }
    return out;
  }
  static byteLength(value, encoding) {
    if (typeof value === "string") return stringToBytes(value, normalizeEncoding(encoding)).length;
    if (value instanceof Uint8Array) return value.length;
    if (value instanceof ArrayBuffer) return value.byteLength;
    return String(value).length;
  }
  static isBuffer(value) {
    return value instanceof _Buffer;
  }
  static isEncoding(encoding) {
    return SUPPORTED_ENCODINGS.includes((encoding ?? "").toLowerCase());
  }
  toString(encoding, start, end) {
    const slice = this.subarray(start ?? 0, end ?? this.length);
    const kind = normalizeEncoding(encoding);
    switch (kind) {
      case "hex":
        return bytesToHex(slice);
      case "base64":
        return bytesToBase64(slice);
      case "latin1":
      case "ascii":
        return bytesToLatin1(slice);
      case "utf8":
      default:
        return bytesToUtf8(slice);
    }
  }
  // Node returns a Buffer (not a Uint8Array) from these, so they are overridden on the typed-array base.
  slice(start, end) {
    return _Buffer.fromBytes(super.slice(start, end));
  }
  subarray(start, end) {
    return _Buffer.fromBytes(super.subarray(start, end));
  }
  includes(search, position = 0) {
    return this.indexOf(search, position) >= 0;
  }
  indexOf(search, position = 0) {
    if (typeof search === "number") return super.indexOf(search & 255, position);
    for (let index = position; index <= this.length - search.length; index += 1) {
      let matched = true;
      for (let inner = 0; inner < search.length; inner += 1) {
        if (this[index + inner] !== search[inner]) {
          matched = false;
          break;
        }
      }
      if (matched) return index;
    }
    return -1;
  }
  copy(target, targetStart = 0, sourceStart = 0, sourceEnd = this.length) {
    const chunk = this.subarray(sourceStart, Math.min(sourceEnd, this.length));
    target.set(chunk.subarray(0, Math.min(chunk.length, target.length - targetStart)), targetStart);
    return Math.min(chunk.length, target.length - targetStart);
  }
  equals(other) {
    if (other.length !== this.length) return false;
    for (let index = 0; index < this.length; index += 1) if (this[index] !== other[index]) return false;
    return true;
  }
  readUInt8(offset = 0) {
    return this[offset];
  }
  readUInt16LE(offset = 0) {
    return this[offset] | this[offset + 1] << 8;
  }
  readUInt16BE(offset = 0) {
    return this[offset] << 8 | this[offset + 1];
  }
  readUInt32LE(offset = 0) {
    return (this[offset] | this[offset + 1] << 8 | this[offset + 2] << 16) + this[offset + 3] * 16777216;
  }
  readUInt32BE(offset = 0) {
    return this[offset] * 16777216 + (this[offset + 1] << 16 | this[offset + 2] << 8 | this[offset + 3]);
  }
  writeUInt16LE(value, offset = 0) {
    this[offset] = value & 255;
    this[offset + 1] = value >> 8 & 255;
    return offset + 2;
  }
  writeUInt32LE(value, offset = 0) {
    this[offset] = value & 255;
    this[offset + 1] = value >> 8 & 255;
    this[offset + 2] = value >> 16 & 255;
    this[offset + 3] = value >>> 24 & 255;
    return offset + 4;
  }
};
function stringToBytes(text, encoding) {
  switch (encoding) {
    case "hex":
    case "base64":
      return bytesFromHostPayload(text);
    case "latin1":
    case "ascii":
      return latin1ToBytes(text);
    case "utf8":
    default:
      return utf8ToBytes(text);
  }
}
var transpile = notImplemented("buffer", "transpile");
var resolveObjectURL = notImplemented("buffer", "resolveObjectURL", "blob: URLs are not the realm's");

// packages/quickjs-shims/src/ops.ts
async function opFsStatAsync(path) {
  return await hostCallAsync("fs.stat", { path });
}
async function opFsListAsync(path, options = {}) {
  return await hostCallAsync("fs.list", { path, ...options });
}
async function opFsReadTextAsync(path) {
  return await hostCallAsync("fs.readText", { path });
}
async function opFsWriteTextAsync(path, content) {
  await hostCallAsync("fs.writeText", { path, content });
}
async function opFsEnsureDirAsync(path) {
  await hostCallAsync("fs.ensureDir", { path });
}
async function opFsMoveAsync(source, target) {
  await hostCallAsync("fs.move", { source, target });
}
async function opFsDeleteAsync(path, recursive = false) {
  await hostCallAsync("fs.delete", { path, recursive });
}
async function opProcExecAsync(program, args, options = {}) {
  return await hostCallAsync("proc.exec", { program, args, ...options });
}
function opRandomUUID() {
  return String(hostCall("crypto.randomUUID", {}));
}
function opRandomBytes(length) {
  return hostCall("crypto.randomBytes", { length });
}
function opTmpdir() {
  return String(hostCall("os.tmpdir", {}));
}

// packages/quickjs-shims/src/crypto.ts
function randomUUID() {
  return opRandomUUID();
}
function randomBytes(length) {
  if (!Number.isInteger(length) || length < 0) {
    throw new RangeError(`crypto.randomBytes: length must be a non-negative integer, received ${String(length)}`);
  }
  return bytesFromHostPayload(opRandomBytes(length), length);
}
var createHash = notImplemented("crypto", "createHash", "crypto.digest(algorithm, bytes) -> { hex }");
var createHmac = notImplemented("crypto", "createHmac");
var hash = notImplemented("crypto", "hash", "crypto.digest(algorithm, bytes) -> { hex }");
var randomFill = notImplemented("crypto", "randomFill", "crypto.randomFill(byteLength) -> bytes");
var randomFillSync = notImplemented("crypto", "randomFillSync", "crypto.randomFill(byteLength) -> bytes");
var HOST_RANDOM_CEILING = 64;
function getRandomValues(target) {
  if (target === null || target === void 0) return target;
  const bytes = new Uint8Array(target.buffer, target.byteOffset ?? 0, target.byteLength);
  if (bytes.length > HOST_RANDOM_CEILING) {
    throw new RangeError(
      `crypto.getRandomValues: ${String(bytes.length)} bytes exceeds the host's ${String(HOST_RANDOM_CEILING)}-byte entropy ceiling; ask the host for crypto.randomFill(byteLength) -> bytes`
    );
  }
  bytes.set(randomBytes(bytes.length));
  return target;
}
function createCryptoGlobal() {
  return { randomUUID, getRandomValues };
}
var randomInt = notImplemented("crypto", "randomInt");
var timingSafeEqual = notImplemented("crypto", "timingSafeEqual");
var createCipheriv = notImplemented("crypto", "createCipheriv");
var createDecipheriv = notImplemented("crypto", "createDecipheriv");
var createSign = notImplemented("crypto", "createSign");
var createVerify = notImplemented("crypto", "createVerify");
var pbkdf2 = notImplemented("crypto", "pbkdf2");
var pbkdf2Sync = notImplemented("crypto", "pbkdf2Sync");
var scrypt = notImplemented("crypto", "scrypt");
var scryptSync = notImplemented("crypto", "scryptSync");

// packages/quickjs-shims/src/process.ts
var cached;
function createProcessShim() {
  if (cached !== void 0) return cached;
  const info = hasHost() ? platformInfo() : platformInfoOrFallback();
  const env = hasHost() ? hostEnv() : {};
  cached = {
    platform: info.platform,
    arch: info.arch,
    env,
    cwd: () => (hasHost() ? platformInfo() : platformInfoOrFallback()).cwd,
    argv: [],
    argv0: "",
    execArgv: [],
    execPath: "",
    title: "xiranite-quickjs",
    version: "quickjs-ng",
    versions: { quickjs: "ng" },
    nextTick: (callback, ...args) => queueMicrotask(() => callback(...args)),
    hrtime: (prev) => {
      const ns = BigInt(Math.round(performanceNowNs()));
      if (!prev) return [Number(ns / 1000000000n), Number(ns % 1000000000n)];
      const base = BigInt(prev[0]) * 1000000000n + BigInt(prev[1]);
      const delta = ns >= base ? ns - base : 0n;
      return [Number(delta / 1000000000n), Number(delta % 1000000000n)];
    },
    hrtimeBigint: (prev) => {
      const ns = BigInt(Math.round(performanceNowNs()));
      return prev ? ns - prev : ns;
    },
    features: { inspector: false, cpuProfiler: false },
    exit: notImplemented("process", "exit"),
    abort: notImplemented("process", "abort"),
    kill: notImplemented("process", "kill"),
    chdir: notImplemented("process", "chdir", "the working directory is the host's")
  };
  return cached;
}
function performanceNowNs() {
  const perf = globalThis.performance;
  if (typeof perf?.now === "function") return perf.now() * 1e6;
  return Date.now() * 1e6;
}
var process_default = createProcessShim();

// packages/quickjs-shims/src/index.ts
function installShimGlobals(target = globalThis) {
  const realm = target;
  if (target.process === void 0) target.process = createProcessShim();
  if (target.Buffer === void 0) target.Buffer = Buffer2;
  if (realm.global === void 0) realm.global = realm;
  if (realm.crypto === void 0) realm.crypto = createCryptoGlobal();
}
installShimGlobals();

// packages/nodes/gifu/src/core.ts
var GIFU_ARCHIVE_EXTENSIONS = [
  ".zip",
  ".cbz",
  ".tar",
  ".tgz",
  ".tar.gz",
  ".tar.bz2",
  ".tbz2",
  ".tar.xz",
  ".txz"
];
var GIFU_IMAGE_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".bmp",
  ".tif",
  ".tiff",
  ".gif",
  ".avif",
  ".jxl"
];
var defaultGifuInput = {
  action: "plan",
  paths: [],
  path: "",
  listText: "",
  listFile: "",
  configPath: "",
  configText: "",
  databasePath: "",
  recordRun: false,
  recursive: true,
  format: "webp",
  outDir: "",
  outMode: "same",
  namePrefix: "[#dyna]",
  nameTemplate: "{prefix}{stem}",
  durationMs: 120,
  loop: 0,
  quality: 85,
  webpMethod: 2,
  ffmpegThreads: 0,
  webmCrf: 34,
  webmCpuUsed: 6,
  mp4Preset: "p3",
  mp4Cq: 32,
  maxWorkers: 0,
  extractSingle: true,
  overwrite: false,
  dryRun: true
};
function normalizeGifuInput(input) {
  const format = input.format === "wbp" ? "webp" : input.format ?? defaultGifuInput.format;
  const template = clean(input.nameTemplate) || defaultGifuInput.nameTemplate;
  return {
    ...defaultGifuInput,
    ...defined(input),
    action: input.action ?? defaultGifuInput.action,
    path: clean(input.path),
    paths: uniqueClean([input.path, ...input.paths ?? [], ...parsePathList(input.listText ?? "")]),
    listText: input.listText ?? "",
    listFile: clean(input.listFile),
    configPath: clean(input.configPath),
    configText: input.configText ?? "",
    databasePath: clean(input.databasePath),
    recursive: input.recursive ?? defaultGifuInput.recursive,
    format,
    outDir: clean(input.outDir),
    outMode: input.outMode ?? defaultGifuInput.outMode,
    namePrefix: input.namePrefix === void 0 ? defaultGifuInput.namePrefix : input.namePrefix.trim(),
    nameTemplate: template.includes("{stem}") ? template : `${template}{stem}`,
    durationMs: finiteOr(input.durationMs, defaultGifuInput.durationMs),
    loop: finiteOr(input.loop, defaultGifuInput.loop),
    quality: finiteOr(input.quality, defaultGifuInput.quality),
    webpMethod: finiteOr(input.webpMethod, defaultGifuInput.webpMethod),
    ffmpegThreads: finiteOr(input.ffmpegThreads, defaultGifuInput.ffmpegThreads),
    webmCrf: finiteOr(input.webmCrf, defaultGifuInput.webmCrf),
    webmCpuUsed: finiteOr(input.webmCpuUsed, defaultGifuInput.webmCpuUsed),
    mp4Preset: clean(input.mp4Preset) || defaultGifuInput.mp4Preset,
    mp4Cq: finiteOr(input.mp4Cq, defaultGifuInput.mp4Cq),
    maxWorkers: finiteOr(input.maxWorkers, defaultGifuInput.maxWorkers),
    extractSingle: input.extractSingle ?? defaultGifuInput.extractSingle,
    overwrite: input.overwrite ?? defaultGifuInput.overwrite,
    dryRun: input.dryRun ?? defaultGifuInput.dryRun,
    recordRun: input.recordRun ?? Boolean(input.databasePath)
  };
}
async function runGifu(input, runtime, onEvent = () => {
}) {
  try {
    const listInput = input.listFile ? await readListFileInput(input.listFile, runtime) : {};
    const configInput = await loadGifuConfigInput(input, runtime);
    const normalized = normalizeGifuInput(mergeGifuConfigInput(mergeGifuConfigInput(configInput, listInput), input));
    const validationError = validateGifuInput(normalized);
    if (validationError) return failure(validationError);
    if (!normalized.paths.length) return failure("At least one archive, directory, or list entry is required.");
    const config = await loadGifuConfigSummary(normalized, runtime);
    onEvent({ type: "progress", progress: 10, message: "Collecting archives." });
    const archivePaths = await collectArchives(normalized.paths, normalized.recursive, runtime);
    const commonRoot = normalized.outMode === "separate" ? findCommonParent(archivePaths, runtime) : "";
    const scans = [];
    for (let index = 0; index < archivePaths.length; index += 1) {
      const archivePath = archivePaths[index];
      const progress = archivePaths.length ? 15 + Math.round((index + 1) / archivePaths.length * 40) : 55;
      onEvent({ type: "progress", progress, message: `Inspecting ${runtime.basename(archivePath)}.` });
      try {
        const images = await runtime.listArchiveImages(archivePath);
        const imageCount = images.length;
        scans.push({
          images,
          plan: {
            archivePath,
            outputPath: buildOutputPath(archivePath, normalized, runtime, commonRoot),
            imageCount,
            format: effectiveGifuFormat(normalized.format),
            status: imageCount >= 2 ? "ready" : imageCount === 1 ? "single" : "empty"
          }
        });
      } catch (error) {
        const message = messageOf(error);
        scans.push({
          images: [],
          plan: {
            archivePath,
            outputPath: buildOutputPath(archivePath, normalized, runtime, commonRoot),
            imageCount: 0,
            format: effectiveGifuFormat(normalized.format),
            status: "failed",
            error: message
          }
        });
      }
    }
    const command = buildGifuCommand(normalized);
    const database = buildGifuDatabase(normalized, scans.map((item) => item.plan), runtime);
    if (normalized.action !== "make" || normalized.dryRun) {
      const archives2 = scans.map((item) => item.plan);
      const action = normalized.action === "make" ? "plan" : normalized.action;
      await writeGifuRecordIfEnabled(action, normalized, archives2, command, void 0, database, runtime);
      const failed = archives2.filter((item) => item.status === "failed").length;
      return {
        success: failed === 0,
        message: failed ? `Gifu inspected ${archives2.length} archive(s) with ${failed} failure(s).` : `Gifu planned ${archives2.length} archive(s).`,
        data: data({ archives: archives2, config, database, command })
      };
    }
    onEvent({ type: "progress", progress: 60, message: "Starting native conversion." });
    let completed = 0;
    const archives = await mapConcurrent(scans, resolveMaxWorkers(normalized.maxWorkers, scans.length), async ({ plan, images }) => {
      if (plan.status === "failed") return plan;
      if (runtime.isCancelled?.()) return { ...plan, status: "skipped", message: "Cancelled." };
      if (plan.status === "empty") return { ...plan, status: "skipped", message: "No supported image entries." };
      if (plan.status === "single" && !normalized.extractSingle) {
        return { ...plan, status: "skipped", message: "Single-image extraction is disabled." };
      }
      try {
        const outcome = await runtime.convertArchive({
          archivePath: plan.archivePath,
          outputPath: plan.outputPath,
          images,
          format: effectiveGifuFormat(normalized.format),
          durationMs: normalized.durationMs,
          loop: normalized.loop,
          quality: normalized.quality,
          webpMethod: normalized.webpMethod,
          ffmpegThreads: normalized.ffmpegThreads,
          webmCrf: normalized.webmCrf,
          webmCpuUsed: normalized.webmCpuUsed,
          mp4Preset: normalized.mp4Preset,
          mp4Cq: normalized.mp4Cq,
          extractSingle: normalized.extractSingle,
          overwrite: normalized.overwrite
        });
        return {
          ...plan,
          outputPath: outcome.outputPath,
          status: outcome.status,
          decodedFrames: outcome.decodedFrames,
          skippedFrames: outcome.skippedFrames,
          encoder: outcome.encoder,
          message: outcome.message
        };
      } catch (error) {
        return { ...plan, status: "failed", error: messageOf(error) };
      } finally {
        completed += 1;
        const progress = 60 + Math.round(completed / Math.max(1, scans.length) * 35);
        onEvent({ type: "progress", progress, message: `Finished ${completed}/${scans.length} archive(s).` });
      }
    });
    const summary = data({ archives, config, database, command });
    const commandResult = {
      code: summary.failedCount ? 1 : 0,
      stdout: `${summary.convertedCount} converted, ${summary.extractedCount} extracted, ${summary.skippedCount} skipped`,
      stderr: summary.errors.join("\n")
    };
    summary.commandResult = commandResult;
    await writeGifuRecordIfEnabled("make", normalized, archives, command, commandResult, database, runtime);
    onEvent({ type: "progress", progress: 100, message: "Native conversion finished." });
    return {
      success: summary.failedCount === 0,
      message: summary.failedCount ? `Gifu completed with ${summary.failedCount} failure(s).` : `Gifu converted ${summary.convertedCount} archive(s) and extracted ${summary.extractedCount} single image(s).`,
      data: summary
    };
  } catch (error) {
    return failure(messageOf(error));
  }
}
async function loadGifuConfigInput(input, runtime) {
  const text = input.configText || (input.configPath ? await runtime.readText(input.configPath) : "");
  if (!text.trim()) return {};
  return parseGifuTomlConfig(text);
}
async function readListFileInput(path, runtime) {
  return { paths: parsePathList(await runtime.readText(path)) };
}
async function loadGifuConfigSummary(input, runtime) {
  const text = input.configText || (input.configPath ? await runtime.readText(input.configPath) : "");
  if (!text.trim()) return void 0;
  const parsed = parseTomlLikeKeys(text);
  return { path: input.configPath, keys: parsed.keys, tables: parsed.tables };
}
function mergeGifuConfigInput(config, input) {
  const merged = { ...config };
  for (const [key, value] of Object.entries(input)) {
    if (value !== void 0) merged[key] = value;
  }
  return merged;
}
function parseGifuTomlConfig(text) {
  const values = parseTomlLikeValues(text);
  return {
    path: stringValue(first(values, "path", "input.path")),
    paths: arrayValue(first(values, "paths", "input.paths")),
    listText: stringValue(first(values, "listText", "list_text", "input.list_text")),
    listFile: stringValue(first(values, "listFile", "list_file", "input.list_file")),
    recursive: booleanValue(first(values, "recursive", "input.recursive")),
    format: enumValue(first(values, "format", "output.format"), ["auto", "gif", "webp", "wbp", "apng", "webm", "mp4"]),
    outDir: stringValue(first(values, "outDir", "out_dir", "output.out_dir")),
    outMode: enumValue(first(values, "outMode", "out_mode", "output.out_mode"), ["same", "separate"]),
    namePrefix: stringValue(first(values, "namePrefix", "name_prefix", "naming.prefix")),
    nameTemplate: stringValue(first(values, "nameTemplate", "name_template", "naming.template")),
    durationMs: numberValue(first(values, "durationMs", "duration_ms", "output.duration_ms")),
    loop: numberValue(first(values, "loop", "output.loop")),
    quality: numberValue(first(values, "quality", "output.quality")),
    webpMethod: numberValue(first(values, "webpMethod", "webp_method", "output.webp_method")),
    ffmpegThreads: numberValue(first(values, "ffmpegThreads", "ffmpeg_threads", "video.ffmpeg_threads")),
    webmCrf: numberValue(first(values, "webmCrf", "webm_crf", "video.webm_crf")),
    webmCpuUsed: numberValue(first(values, "webmCpuUsed", "webm_cpu_used", "video.webm_cpu_used")),
    mp4Preset: stringValue(first(values, "mp4Preset", "mp4_preset", "video.mp4_preset")),
    mp4Cq: numberValue(first(values, "mp4Cq", "mp4_cq", "video.mp4_cq")),
    maxWorkers: numberValue(first(values, "maxWorkers", "max_workers", "performance.max_workers")),
    extractSingle: booleanValue(first(values, "extractSingle", "extract_single", "output.extract_single")),
    overwrite: booleanValue(first(values, "overwrite", "execution.overwrite")),
    dryRun: booleanValue(first(values, "dryRun", "dry_run", "execution.dry_run")),
    databasePath: stringValue(first(values, "databasePath", "database_path", "record.path")),
    recordRun: booleanValue(first(values, "recordRun", "record_run", "record.enabled"))
  };
}
function parseTomlLikeKeys(text) {
  const keys = /* @__PURE__ */ new Set();
  const tables = /* @__PURE__ */ new Set();
  let table = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = stripTomlComment(raw).trim();
    if (!line) continue;
    const match = /^\[([^\]]+)]$/.exec(line);
    if (match) {
      table = match[1].trim();
      tables.add(table);
      continue;
    }
    const index = line.indexOf("=");
    if (index > 0) keys.add(table ? `${table}.${line.slice(0, index).trim()}` : line.slice(0, index).trim());
  }
  return { keys: [...keys].sort(), tables: [...tables].sort() };
}
function validateGifuInput(input) {
  if (input.durationMs <= 0) return "durationMs must be greater than zero.";
  if (input.loop < 0) return "loop must be greater than or equal to zero.";
  if (input.quality < 1 || input.quality > 100) return "quality must be between 1 and 100.";
  if (input.webpMethod < 0 || input.webpMethod > 6) return "webpMethod must be between 0 and 6.";
  if (input.ffmpegThreads < 0) return "ffmpegThreads must be greater than or equal to zero.";
  if (input.webmCrf < 0 || input.webmCrf > 63) return "webmCrf must be between 0 and 63.";
  if (input.webmCpuUsed < 0 || input.webmCpuUsed > 8) return "webmCpuUsed must be between 0 and 8.";
  if (!/^p[1-7]$/.test(input.mp4Preset)) return "mp4Preset must be p1 through p7.";
  if (input.mp4Cq < 0 || input.mp4Cq > 63) return "mp4Cq must be between 0 and 63.";
  if (input.maxWorkers < 0) return "maxWorkers must be greater than or equal to zero.";
  return null;
}
function buildGifuDatabase(input, archives, runtime) {
  const path = input.databasePath || defaultGifuDatabasePath(input, archives, runtime);
  if (!path) return void 0;
  return { path, enabled: input.recordRun, mode: "jsonl", defaultPath: !input.databasePath };
}
function defaultGifuDatabasePath(input, archives, runtime) {
  const fallback = input.paths[0] ?? "";
  const base = input.outDir || (archives[0] ? runtime.dirname(archives[0].archivePath) : isGifuArchive(fallback) ? runtime.dirname(fallback) : fallback);
  return base ? runtime.join(base, ".xiranite", "gifu-runs.jsonl") : "";
}
function buildGifuRunRecord(action, input, archives, command, commandResult) {
  const summary = data({ archives });
  return {
    toolId: "gifu",
    engine: "native-ts",
    action,
    paths: input.paths,
    options: {
      recursive: input.recursive,
      format: input.format,
      outMode: input.outMode,
      outDir: input.outDir || void 0,
      durationMs: input.durationMs,
      loop: input.loop,
      quality: input.quality,
      maxWorkers: input.maxWorkers,
      extractSingle: input.extractSingle,
      overwrite: input.overwrite,
      dryRun: input.dryRun
    },
    archiveCount: archives.length,
    readyCount: summary.readyCount,
    convertedCount: summary.convertedCount,
    extractedCount: summary.extractedCount,
    skippedCount: summary.skippedCount,
    failedCount: summary.failedCount,
    command,
    success: commandResult ? commandResult.code === 0 : summary.failedCount === 0,
    code: commandResult?.code,
    at: (/* @__PURE__ */ new Date()).toISOString()
  };
}
async function collectArchives(paths, recursive, runtime) {
  const found = [];
  const seen = /* @__PURE__ */ new Set();
  async function add(path) {
    const key = path.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    found.push(path);
  }
  async function visit(path) {
    const info = await runtime.pathInfo(path);
    if (!info.exists) return;
    if (info.isFile) {
      if (isGifuArchive(info.path)) await add(info.path);
      return;
    }
    if (!info.isDirectory) return;
    const entries = await runtime.listDir(info.path);
    entries.sort((a, b) => a.name.localeCompare(b.name, void 0, { numeric: true, sensitivity: "base" }));
    for (const entry of entries) {
      if (entry.isFile && isGifuArchive(entry.path)) await add(entry.path);
      else if (recursive && entry.isDirectory) await visit(entry.path);
    }
  }
  for (const path of paths) await visit(path);
  return found;
}
function buildGifuCommand(input) {
  const args = [input.action, ...input.paths, "--format", effectiveGifuFormat(input.format), input.recursive ? "--recursive" : "--no-recursive"];
  args.push("--duration", String(input.durationMs), "--out-mode", input.outMode);
  if (input.outDir) args.push("--out-dir", input.outDir);
  if (input.overwrite) args.push("--overwrite");
  if (input.dryRun) args.push("--dry-run");
  return { command: "gifu-native", args };
}
function buildOutputPath(archivePath, input, runtime, commonRoot = "") {
  const format = effectiveGifuFormat(input.format);
  const extension = `.${format}`;
  const parent = runtime.dirname(archivePath);
  const archive = runtime.basename(archivePath);
  const stem = archive.slice(0, Math.max(0, archive.length - runtime.extname(archive).length)) || archive;
  if (input.outMode === "separate") {
    let root = commonRoot || parent;
    let relativeParent = runtime.relative(root, parent);
    if (isOutsideRelative(relativeParent)) {
      root = parent;
      relativeParent = "";
    }
    const base = input.outDir || runtime.dirname(root);
    const directory = sanitizeOutputStem(`${input.namePrefix}${runtime.basename(root) || "output"}`);
    const outputName2 = `${sanitizeOutputStem(renderTemplate("{stem}", { prefix: "", stem, archive, parent: runtime.basename(parent) }))}${extension}`;
    return relativeParent ? runtime.join(base, directory, relativeParent, outputName2) : runtime.join(base, directory, outputName2);
  }
  const outputName = `${sanitizeOutputStem(renderTemplate(input.nameTemplate, { prefix: input.namePrefix, stem, archive, parent: runtime.basename(parent) }))}${extension}`;
  return runtime.join(input.outDir || parent, outputName);
}
function findCommonParent(paths, runtime) {
  if (!paths.length) return "";
  let common = runtime.dirname(paths[0]);
  for (const path of paths.slice(1)) {
    const parent = runtime.dirname(path);
    while (common && isOutsideRelative(runtime.relative(common, parent))) {
      const next = runtime.dirname(common);
      if (!next || next === common) return "";
      common = next;
    }
  }
  return common;
}
function resolveMaxWorkers(requested, taskCount) {
  if (taskCount <= 1) return Math.max(1, taskCount);
  if (requested > 0) return Math.max(1, Math.min(Math.floor(requested), taskCount));
  return Math.max(1, Math.min(4, taskCount));
}
function parsePathList(text) {
  return text.split(/\r?\n|;/).map(clean).filter((line) => line && !line.startsWith("#"));
}
function isGifuArchive(path) {
  const lower = path.toLowerCase();
  return GIFU_ARCHIVE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}
function isGifuImage(path) {
  const lower = path.toLowerCase();
  return GIFU_IMAGE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}
function effectiveGifuFormat(format) {
  return format === "auto" || format === "wbp" ? "webp" : format;
}
async function writeGifuRecordIfEnabled(action, input, archives, command, commandResult, database, runtime) {
  if (database?.enabled) await runtime.appendRecord(database.path, buildGifuRunRecord(action, input, archives, command, commandResult));
}
function renderTemplate(template, values) {
  if (/\{(?!prefix}|stem}|archive}|parent})[^}]+}/.test(template)) return `${values.prefix}${values.stem}`;
  return template.replace(/\{(prefix|stem|archive|parent)}/g, (_, key) => values[key] ?? "");
}
function sanitizeOutputStem(value) {
  const cleaned = value.replace(/[<>:"/\\|?*]/g, "_").trim().replace(/^\.+|\.+$/g, "");
  return cleaned || "output";
}
function parseTomlLikeValues(text) {
  const values = {};
  let table = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = stripTomlComment(raw).trim();
    if (!line) continue;
    const tableMatch = /^\[([^\]]+)]$/.exec(line);
    if (tableMatch) {
      table = tableMatch[1].trim();
      continue;
    }
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    values[key] = line.slice(index + 1).trim();
    if (table) values[`${table}.${key}`] = values[key];
  }
  return values;
}
function stripTomlComment(value) {
  let quote = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if ((char === '"' || char === "'") && value[index - 1] !== "\\") quote = quote === char ? "" : quote || char;
    if (char === "#" && !quote) return value.slice(0, index);
  }
  return value;
}
function first(values, ...keys) {
  for (const key of keys) if (values[key] !== void 0) return values[key];
  return void 0;
}
function stringValue(value) {
  if (value === void 0) return void 0;
  return value.trim().replace(/^(["'])|(["'])$/g, "");
}
function arrayValue(value) {
  if (value === void 0) return void 0;
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return [stringValue(trimmed) ?? ""].filter(Boolean);
  return trimmed.slice(1, -1).split(",").map(stringValue).filter((item) => Boolean(item));
}
function booleanValue(value) {
  const normalized = stringValue(value)?.toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  return void 0;
}
function numberValue(value) {
  if (value === void 0) return void 0;
  const parsed = Number(stringValue(value));
  return Number.isFinite(parsed) ? parsed : void 0;
}
function enumValue(value, allowed) {
  const normalized = stringValue(value)?.toLowerCase();
  return allowed.find((item) => item === normalized);
}
function data(partial) {
  const archives = partial.archives ?? [];
  const errors = archives.flatMap((item) => item.error ? [`${item.archivePath}: ${item.error}`] : []);
  return {
    archives,
    readyCount: archives.filter((item) => item.status === "ready").length,
    singleCount: archives.filter((item) => item.status === "single").length,
    emptyCount: archives.filter((item) => item.status === "empty").length,
    convertedCount: archives.filter((item) => item.status === "converted").length,
    extractedCount: archives.filter((item) => item.status === "extracted").length,
    skippedCount: archives.filter((item) => item.status === "skipped").length,
    failedCount: archives.filter((item) => item.status === "failed").length,
    errors,
    ...partial
  };
}
function failure(message) {
  return { success: false, message, data: data({ archives: [], errors: [message] }) };
}
function clean(value) {
  const text = String(value ?? "").trim();
  if (text.length >= 2 && (text.startsWith('"') && text.endsWith('"') || text.startsWith("'") && text.endsWith("'"))) return text.slice(1, -1).trim();
  return text;
}
function uniqueClean(values) {
  return [...new Set(values.map(clean).filter(Boolean))];
}
function finiteOr(value, fallback) {
  return Number.isFinite(value) ? Number(value) : fallback;
}
function defined(input) {
  const result = {};
  for (const [key, value] of Object.entries(input)) if (value !== void 0) result[key] = value;
  return result;
}
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
function isOutsideRelative(value) {
  return value === ".." || value.startsWith(`..\\`) || value.startsWith("../") || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("/");
}
async function mapConcurrent(items, limit, worker) {
  const results = Array.from({ length: items.length });
  let next = 0;
  const runners = Array.from({ length: Math.min(Math.max(1, limit), Math.max(1, items.length)) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

// packages/quickjs-shims/src/child-process.ts
var customPromisifyArgs = /* @__PURE__ */ Symbol.for("nodejs.util.promisify.custom_args");
function wantsBytes(encoding, context) {
  if (encoding === void 0 || encoding === "utf8" || encoding === "utf-8") return;
  if (encoding === "buffer") {
    throw new QuickJsShimError(
      SHIM_ERROR_CODES.signatureUnsupported,
      `${context}: encoding "buffer" needs stdout as bytes. The host must answer proc.exec with a byte-capable result (ADR-0074 decision 3: bytes cross as bytes).`,
      { requiredOperation: "proc.exec -> ArrayBuffer stdout" }
    );
  }
  throw new QuickJsShimError(SHIM_ERROR_CODES.signatureUnsupported, `${context}: unsupported encoding ${JSON.stringify(encoding)}.`);
}
function readOptions(maybeOptions) {
  if (maybeOptions === null || maybeOptions === void 0 || typeof maybeOptions === "function") return {};
  if (typeof maybeOptions !== "object") {
    throw new QuickJsShimError(SHIM_ERROR_CODES.signatureUnsupported, `child_process options must be an object, got ${typeof maybeOptions}.`);
  }
  return maybeOptions;
}
function payloadFor(options, context) {
  if (options.shell !== void 0 && options.shell !== false) {
    throw new QuickJsShimError(
      SHIM_ERROR_CODES.signatureUnsupported,
      `${context}: shell is refused. The host's external-program allowlist is the permission boundary; a shell would move the decision to argv string concatenation.`,
      { shell: options.shell }
    );
  }
  wantsBytes(options.encoding, context);
  return {
    cwd: options.cwd === void 0 ? void 0 : toPathString(options.cwd, context),
    env: options.env,
    timeoutMs: typeof options.timeout === "number" ? options.timeout : options.timeoutMs,
    maxBufferBytes: typeof options.maxBuffer === "number" ? options.maxBuffer : options.maxBufferBytes,
    encoding: options.encoding
  };
}
function failureFrom(result, file, args) {
  const code = typeof result.exitCode === "number" ? result.exitCode : null;
  const rejected = result.rejected === true;
  const failed = rejected || result.success === false || code !== null && code !== 0;
  if (!failed) return null;
  const message = rejected ? `spawn ${file} ${args.join(" ")} EACCES: the host refused the program (not on the external-program allowlist).` : `Command failed: ${file} ${args.join(" ")}
${result.stderr || ""}`;
  const error = new Error(message);
  error.code = rejected ? "EACCES" : code ?? "UNKNOWN";
  error.stdout = result.stdout;
  error.stderr = result.stderr;
  error.signal = result.signal ?? null;
  return error;
}
function execFile(file, argsOrCallback, optionsOrCallback, maybeCallback) {
  const argv = Array.isArray(argsOrCallback) ? argsOrCallback : [];
  const rawOptions = Array.isArray(argsOrCallback) ? optionsOrCallback : argsOrCallback;
  const callback = typeof maybeCallback === "function" ? maybeCallback : typeof optionsOrCallback === "function" ? optionsOrCallback : typeof argsOrCallback === "function" ? argsOrCallback : void 0;
  const options = readOptions(rawOptions);
  const payload = payloadFor(options, "child_process.execFile");
  if (typeof callback === "function") {
    opProcExecAsync(file, argv, payload).then(
      (result) => callback(failureFrom(result, file, argv), result.stdout, result.stderr),
      (reason) => callback(reason instanceof Error ? reason : new Error(String(reason)), "", "")
    );
    return void 0;
  }
  return opProcExecAsync(file, argv, payload).then((result) => {
    const error = failureFrom(result, file, argv);
    if (error !== null) throw error;
    return { stdout: result.stdout, stderr: result.stderr };
  });
}
execFile[customPromisifyArgs] = ["stdout", "stderr"];
var spawn = notImplemented("child_process", "spawn", "proc.spawn(program, args, { cwd }) -> handle");
var spawnSync = notImplemented("child_process", "spawnSync", "proc.exec already waits; spawnSync needs no new op but is not wired here");
var exec = notImplemented("child_process", "exec", "shell string parsing bypasses the allowlist; call execFile(program, argv) instead");
var execSync = notImplemented("child_process", "execSync", "shell string parsing bypasses the allowlist; call execFileSync(program, argv) instead");
var fork = notImplemented("child_process", "fork");

// packages/quickjs-shims/src/fs-promises.ts
var fs_promises_exports = {};
__export(fs_promises_exports, {
  access: () => access,
  appendFile: () => appendFile,
  chmod: () => chmod,
  chown: () => chown,
  copyFile: () => copyFile,
  cp: () => cp,
  default: () => fs_promises_default,
  glob: () => glob,
  link: () => link,
  lstat: () => lstat,
  lutimes: () => lutimes,
  mkdir: () => mkdir,
  mkdtemp: () => mkdtemp,
  open: () => open,
  opendir: () => opendir,
  readFile: () => readFile,
  readText: () => readText,
  readdir: () => readdir,
  readlink: () => readlink,
  readv: () => readv,
  realpath: () => realpath,
  rename: () => rename,
  rm: () => rm,
  rmdir: () => rmdir,
  stat: () => stat,
  statfs: () => statfs,
  symlink: () => symlink,
  truncate: () => truncate,
  unlink: () => unlink,
  utimes: () => utimes,
  watch: () => watch,
  watchFile: () => watchFile,
  withCallback: () => withCallback,
  writeFile: () => writeFile,
  writeText: () => writeText,
  writev: () => writev
});
function checkTextEncoding(encoding, context) {
  if (encoding === void 0) return "utf8";
  const normalized = encoding.toLowerCase();
  if (normalized === "utf8" || normalized === "utf-8") return "utf8";
  throw new QuickJsShimError(
    SHIM_ERROR_CODES.signatureUnsupported,
    `${context}: encoding ${JSON.stringify(encoding)} cannot be honoured. Operations v1 exposes no byte-level read, so a code page must be asked for with \`@xiranite/shared\`'s decodeText over bytes from fs.readBytes once the host serves it.`,
    { encoding, requiredOperation: "fs.readBytes(path, { offset?, length? }) -> ArrayBuffer" }
  );
}
function rejectBinaryPayload(value, context) {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    throw new QuickJsShimError(
      SHIM_ERROR_CODES.signatureUnsupported,
      `${context}: binary payloads do not cross the JSON host envelope. Add the host operation fs.writeBytes(path, bytes, { mode? }) and use it instead.`,
      { requiredOperation: "fs.writeBytes(path, bytes, { mode?, append? }) -> null" }
    );
  }
  if (value === null || value === void 0) {
    throw new QuickJsShimError(SHIM_ERROR_CODES.signatureUnsupported, `${context}: data argument is ${String(value)}.`);
  }
  return String(value);
}
function missingDocument(path) {
  const error = new Error(`ENOENT: no such file or directory, open '${path}'`);
  error.code = "ENOENT";
  error.path = path;
  return error;
}
function textFromReadResult(result, context) {
  if (typeof result?.content === "string") return result.content;
  if (result?.content === null || result?.content === void 0) throw missingDocument(result?.path ?? context);
  throw new QuickJsShimError(SHIM_ERROR_CODES.hostResultInvalid, `host fs.readText returned an unusable answer for ${JSON.stringify(context)}.`);
}
function toDirentsOrNames(entries, withFileTypes) {
  return withFileTypes ? entries.map((entry) => new QuickJSDirent(entry)) : entries.map((entry) => entry.name);
}
function statFrom(payload, context) {
  const info = payload;
  if (info?.exists === false) throw missingDocument(info.path ?? context);
  return QuickJSStats.from(info);
}
async function accessAsync(path, mode) {
  const target = toPathString(path, "fs.promises.access");
  if (mode !== void 0 && mode !== 0) {
    throw new QuickJsShimError(
      SHIM_ERROR_CODES.signatureUnsupported,
      "fs.promises.access: only constants.F_OK is expressible \u2014 the host has no permission operation, and a granted root is not the same question.",
      { mode, requiredOperation: "fs.access(path, { read?, write?, execute? })" }
    );
  }
  const info = await opFsStatAsync(target);
  if (info.exists === false) throw missingDocument(target);
}
async function readFile(path, options) {
  const target = toPathString(path, "fs.promises.readFile");
  const normalized = normalizeEncodingOption(options);
  checkTextEncoding(normalized.encoding, "fs.promises.readFile");
  return textFromReadResult(await opFsReadTextAsync(target), target);
}
async function writeFile(path, data2, options) {
  const target = toPathString(path, "fs.promises.writeFile");
  const normalized = normalizeEncodingOption(options);
  checkTextEncoding(normalized.encoding, "fs.promises.writeFile");
  const content = rejectBinaryPayload(data2, "fs.promises.writeFile");
  const flag = typeof normalized.options["flag"] === "string" ? normalized.options["flag"] : void 0;
  if (flag !== void 0 && flag !== "w") {
    throw new QuickJsShimError(
      SHIM_ERROR_CODES.signatureUnsupported,
      `fs.promises.writeFile: flag ${JSON.stringify(flag)} is not supported; only truncating writes map onto fs.writeText. Use appendFile for "a" or fs.writeBytes once the host serves it.`,
      { flag, requiredOperation: "fs.writeBytes(path, bytes, { mode?, append? })" }
    );
  }
  await opFsWriteTextAsync(target, content);
}
async function readText(path) {
  return readFile(path, "utf8");
}
async function writeText(path, text) {
  await writeFile(path, text, "utf8");
}
async function readdir(path, options) {
  const target = toPathString(path, "fs.promises.readdir");
  if (typeof options?.encoding === "string" && options.encoding !== "utf8") {
    throw new QuickJsShimError(SHIM_ERROR_CODES.signatureUnsupported, `fs.readdir: encoding ${JSON.stringify(options.encoding)} is not supported; host list results are UTF-8 names.`);
  }
  const payload = await opFsListAsync(target, { recursive: options?.recursive });
  return toDirentsOrNames(payload.entries ?? [], options?.withFileTypes === true);
}
async function stat(path) {
  const target = toPathString(path, "fs.promises.stat");
  return statFrom(await opFsStatAsync(target), target);
}
async function lstat(path) {
  const target = toPathString(path, "fs.promises.lstat");
  return statFrom(await opFsStatAsync(target), target);
}
async function mkdir(path, options) {
  const target = toPathString(path, "fs.promises.mkdir");
  if (options?.recursive === false) {
    throw new QuickJsShimError(
      SHIM_ERROR_CODES.signatureUnsupported,
      "fs.promises.mkdir: fs.ensureDir is mkdir -p and cannot report EEXIST for an existing directory. Add fs.mkdirExclusive(path) to the host if a caller depends on that.",
      { requiredOperation: "fs.mkdirExclusive(path) -> null" }
    );
  }
  await opFsEnsureDirAsync(target);
  return void 0;
}
async function rm(path, options) {
  const target = toPathString(path, "fs.promises.rm");
  if (options?.force) {
    const exists2 = await opFsStatAsync(target).then((info) => info.exists !== false, () => false);
    if (!exists2) return;
  }
  await opFsDeleteAsync(target, options?.recursive ?? false);
}
async function unlink(path) {
  await opFsDeleteAsync(toPathString(path, "fs.promises.unlink"), false);
}
async function rmdir(path) {
  await opFsDeleteAsync(toPathString(path, "fs.promises.rmdir"), false);
}
async function rename(source, destination) {
  await opFsMoveAsync(toPathString(source, "fs.promises.rename"), toPathString(destination, "fs.promises.rename"));
}
var access = accessAsync;
var mkdtemp = notImplemented("fs/promises", "mkdtemp", "fs.mkdtemp(prefix) -> path");
var appendFile = notImplemented("fs/promises", "appendFile", "fs.appendText(path, text) -> null");
var copyFile = notImplemented("fs/promises", "copyFile", "fs.copy(source, target, { force? }) -> null");
var cp = notImplemented("fs/promises", "cp", "fs.copy(source, target, { recursive?, force? }) -> null");
var link = notImplemented("fs/promises", "link", "fs.link(source, target)");
var symlink = notImplemented("fs/promises", "symlink", "fs.symlink(target, path, type)");
var readlink = notImplemented("fs/promises", "readlink", "fs.readlink(path)");
var realpath = notImplemented("fs/promises", "realpath", "fs.realpath(path) -> path");
var utimes = notImplemented("fs/promises", "utimes", "fs.utimes(path, atimeMs, mtimeMs)");
var open = notImplemented("fs/promises", "open", "fs.open/readRange/closeHandle host-handle operations");
var chmod = notImplemented("fs/promises", "chmod");
var chown = notImplemented("fs/promises", "chown");
var truncate = notImplemented("fs/promises", "truncate");
var lutimes = notImplemented("fs/promises", "lutimes");
var statfs = notImplemented("fs/promises", "statfs");
var writev = notImplemented("fs/promises", "writev");
var readv = notImplemented("fs/promises", "readv");
var glob = notImplemented("fs/promises", "glob");
var opendir = notImplemented("fs/promises", "opendir");
var watch = notImplemented("fs/promises", "watch");
var watchFile = notImplemented("fs/promises", "watchFile");
var namespace = {
  readFile,
  writeFile,
  readText,
  writeText,
  readdir,
  stat,
  lstat,
  mkdir,
  rm,
  unlink,
  rmdir,
  rename,
  access,
  mkdtemp,
  appendFile,
  copyFile,
  cp,
  link,
  symlink,
  readlink,
  realpath,
  utimes,
  open,
  chmod,
  chown,
  truncate,
  lutimes,
  statfs,
  writev,
  readv,
  glob,
  opendir,
  watch,
  watchFile,
  withCallback
};
var fs_promises_default = namespace;

// packages/quickjs-shims/src/constants.ts
var POSIX_OPEN_FLAGS = {
  O_RDONLY: 0,
  O_WRONLY: 1,
  O_RDWR: 2,
  O_CREAT: 64,
  O_EXCL: 128,
  O_NOCTTY: 256,
  O_TRUNC: 512,
  O_APPEND: 1024,
  O_DIRECT: 16384,
  O_DIRECTORY: 65536,
  O_NOFOLLOW: 131072,
  O_NOATIME: 262144,
  O_CLOEXEC: 524288
};
var WINDOWS_OPEN_FLAGS = {
  O_RDONLY: 0,
  O_WRONLY: 1,
  O_RDWR: 2,
  O_CREAT: 128,
  O_EXCL: 256,
  O_NOCTTY: 0,
  O_TRUNC: 512,
  O_APPEND: 8,
  O_DIRECT: 0,
  O_DIRECTORY: 0,
  O_NOFOLLOW: 0,
  O_NOATIME: 0,
  O_CLOEXEC: 0
};
var OPEN_FLAGS = platformInfoOrFallback().platform === "win32" ? WINDOWS_OPEN_FLAGS : POSIX_OPEN_FLAGS;
var F_OK = 0;
var R_OK = 4;
var W_OK = 2;
var X_OK = 1;
var COPYFILE_EXCL = 1;
var COPYFILE_FICLONE = 2;
var COPYFILE_FICLONE_FORCE = 4;
var S_IFMT = 61440;
var S_IFDIR = 16384;
var S_IFREG = 33188 & 61440;
var S_IFLNK = 40960;
var S_IFBLK = 24576;
var S_IFCHR = 8192;
var S_IFIFO = 4096;
var S_IFSOCK = 49152;
var S_IRUSR = 256;
var S_IWUSR = 128;
var S_IXUSR = 64;
var S_IRGRP = 32;
var S_IWGRP = 16;
var S_IXGRP = 8;
var S_IROTH = 4;
var S_IWOTH = 2;
var S_IXOTH = 1;
var O_RDONLY = OPEN_FLAGS.O_RDONLY;
var O_WRONLY = OPEN_FLAGS.O_WRONLY;
var O_RDWR = OPEN_FLAGS.O_RDWR;
var O_CREAT = OPEN_FLAGS.O_CREAT;
var O_EXCL = OPEN_FLAGS.O_EXCL;
var O_NOCTTY = OPEN_FLAGS.O_NOCTTY;
var O_TRUNC = OPEN_FLAGS.O_TRUNC;
var O_APPEND = OPEN_FLAGS.O_APPEND;
var O_DIRECT = OPEN_FLAGS.O_DIRECT;
var O_DIRECTORY = OPEN_FLAGS.O_DIRECTORY;
var O_NOFOLLOW = OPEN_FLAGS.O_NOFOLLOW;
var O_NOATIME = OPEN_FLAGS.O_NOATIME;
var O_CLOEXEC = OPEN_FLAGS.O_CLOEXEC;
var constants = {
  F_OK,
  R_OK,
  W_OK,
  X_OK,
  COPYFILE_EXCL,
  COPYFILE_FICLONE,
  COPYFILE_FICLONE_FORCE,
  S_IFMT,
  S_IFDIR,
  S_IFREG,
  S_IFLNK,
  S_IFBLK,
  S_IFCHR,
  S_IFIFO,
  S_IFSOCK,
  S_IRUSR,
  S_IWUSR,
  S_IXUSR,
  S_IRGRP,
  S_IWGRP,
  S_IXGRP,
  S_IROTH,
  S_IWOTH,
  S_IXOTH,
  ...OPEN_FLAGS
};

// packages/quickjs-shims/src/fs.ts
var constants2 = constants;
var appendFileSync = notImplemented("fs", "appendFileSync", "fs.appendText(path, text) -> null");
var mkdtempSync = notImplemented("fs", "mkdtempSync", "fs.mkdtemp(prefix) -> path");
var copyFileSync = notImplemented("fs", "copyFileSync", "fs.copy(source, target) -> null");
var cpSync = notImplemented("fs", "cpSync", "fs.copy(source, target, { recursive? }) -> null");
var linkSync = notImplemented("fs", "linkSync", "fs.link(source, target)");
var symlinkSync = notImplemented("fs", "symlinkSync", "fs.symlink(target, path, type)");
var readlinkSync = notImplemented("fs", "readlinkSync", "fs.readlink(path)");
var realpathSync = notImplemented("fs", "realpathSync", "fs.realpath(path) -> path");
var utimesSync = notImplemented("fs", "utimesSync", "fs.utimes(path, atimeMs, mtimeMs)");
var chmodSync = notImplemented("fs", "chmodSync");
var chownSync = notImplemented("fs", "chownSync");
var truncateSync = notImplemented("fs", "truncateSync");
var lutimesSync = notImplemented("fs", "lutimesSync");
var statfsSync = notImplemented("fs", "statfsSync");
var openSync = notImplemented("fs", "openSync", "fs.open/readRange/closeHandle host-handle operations");
var closeSync = notImplemented("fs", "closeSync");
var readSync = notImplemented("fs", "readSync", "fs.readBytes with an offset");
var writeSync = notImplemented("fs", "writeSync");
var createReadStream = notImplemented("fs", "createReadStream", "a host-held byte stream");
var createWriteStream = notImplemented("fs", "createWriteStream", "a host-held byte stream");
var watch2 = notImplemented("fs", "watch");
var watchFile2 = notImplemented("fs", "watchFile");
var unwatchFile = notImplemented("fs", "unwatchFile");
var promises = { ...fs_promises_exports };

// packages/quickjs-shims/src/os.ts
function tmpdir() {
  return opTmpdir();
}
var EOL = platformInfoOrFallback().platform === "win32" ? "\r\n" : "\n";
var hostname = notImplemented("os", "hostname");
var cpus = notImplemented("os", "cpus", "os.cpus() -> [ { model, speed } ]");
var availableParallelism = notImplemented("os", "availableParallelism", "os.cpus() / os.availableParallelism()");
var totalmem = notImplemented("os", "totalmem");
var freemem = notImplemented("os", "freemem");
var networkInterfaces = notImplemented("os", "networkInterfaces");
var userInfo = notImplemented("os", "userInfo");
var uptime = notImplemented("os", "uptime");
var loadavg = notImplemented("os", "loadavg");
var machine = notImplemented("os", "machine");
var release = notImplemented("os", "release");
var devNull = platformInfoOrFallback().platform === "win32" ? "\\\\.\\NUL" : "/dev/null";
var getPriority = notImplemented("os", "getPriority");
var setPriority = notImplemented("os", "setPriority");

// packages/quickjs-shims/src/path.ts
function normalizeSeparators(path) {
  return path.replace(/\\/g, "/");
}
function joinPathsMatch(parts) {
  let joined = "";
  for (let index = 0; index < parts.length; index += 1) {
    const raw = normalizeSeparators(parts[index] ?? "");
    const piece = index === 0 ? trimEnd(raw, "/") : trimBoth(raw, "/");
    if (piece.length === 0) {
      if (index === 0 && raw.startsWith("/")) joined += "/";
      continue;
    }
    if (joined.length > 0 && !joined.endsWith("/")) joined += "/";
    joined += piece;
  }
  return joined;
}
function trimEnd(value, char) {
  let end = value.length;
  while (end > 0 && value[end - 1] === char) end -= 1;
  return value.slice(0, end);
}
function trimBoth(value, char) {
  return trimEnd(trimStart(value, char), char);
}
function trimStart(value, char) {
  let start = 0;
  while (start < value.length && value[start] === char) start += 1;
  return value.slice(start);
}
var posixEngine = { sep: "/", delimiter: ":", win32: false };
var win32Engine = { sep: "\\", delimiter: ";", win32: true };
function native() {
  return hostIsWindows2() ? win32Engine : posixEngine;
}
function hostIsWindows2() {
  try {
    return isWindows();
  } catch {
    return false;
  }
}
function isSeparator(engine, character) {
  return character === engine.sep || engine.win32 && (character === "\\" || character === "/");
}
function sepClass(engine) {
  return engine.win32 ? /[\\/]/ : /\//;
}
function isAbsoluteWith(path, engine) {
  if (engine.win32) {
    if (path.length >= 2 && (path[0] === "\\" || path[0] === "/" || path[1] === "\\" || path[1] === "/")) return true;
    return /^[A-Za-z]:[\\/]/.test(path);
  }
  return path.startsWith("/");
}
function normalizeSegments(path, engine, allowAboveRoot) {
  const out = [];
  for (const segment of path.split(sepClass(engine))) {
    if (segment.length === 0 || segment === ".") continue;
    if (segment === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
      else if (allowAboveRoot) out.push("..");
      continue;
    }
    out.push(segment);
  }
  return out.join(engine.sep);
}
function rootLength(path, engine) {
  if (engine.win32) {
    if (path.length >= 2 && (path[0] === "\\" || path[0] === "/") && (path[1] === "\\" || path[1] === "/")) {
      const second = path.indexOf("\\", 2);
      const secondAlt = path.indexOf("/", 2);
      const next = second === -1 ? secondAlt : secondAlt === -1 ? second : Math.min(second, secondAlt);
      if (next === -1) return path.length;
      const third = indexOfAny(path, next + 1, "\\/");
      return third === -1 ? path.length : third;
    }
    if (/^[A-Za-z]:[\\/]/.test(path)) return 3;
    return 0;
  }
  return path.startsWith("/") ? 1 : 0;
}
function indexOfAny(path, from, characters) {
  for (let index = from; index < path.length; index += 1) {
    if (characters.includes(path[index])) return index;
  }
  return -1;
}
function resolveWith(paths, engine) {
  let resolved = "";
  let absolute = false;
  for (let index = paths.length - 1; index >= -1 && !absolute; index -= 1) {
    const part = index >= 0 ? paths[index] : hostCwd(engine);
    if (typeof part !== "string" || part.length === 0) continue;
    resolved = `${part}${engine.sep}${resolved}`;
    absolute = isAbsoluteWith(part, engine);
  }
  const collapsed = normalizeSegments(resolved, engine, !absolute);
  if (absolute) return engine.sep.length + collapsed.length > 0 ? `${engine.sep}${collapsed}` : engine.sep;
  return collapsed.length > 0 ? collapsed : ".";
}
function hostCwd(engine) {
  try {
    return platformInfo().cwd;
  } catch {
    return engine.win32 ? "\\" : "/";
  }
}
function normalizeWith(path, engine) {
  if (path.length === 0) return ".";
  const isAbs = isAbsoluteWith(path, engine);
  const root = path.slice(0, rootLength(path, engine));
  const trailing = isSeparator(engine, path[path.length - 1]);
  const segments = normalizeSegments(path, engine, !isAbs);
  if (segments.length === 0 && isAbs) return root.length > 0 ? root : engine.sep;
  if (segments.length === 0) return isAbs ? engine.sep : ".";
  const prefixed = isAbs ? `${root}${segments}` : segments;
  return trailing ? `${prefixed}${engine.sep}` : prefixed;
}
function dirnameWith(path, engine) {
  if (path.length === 0) return ".";
  const root = path.slice(0, rootLength(path, engine));
  let end = path.length;
  while (end > 1 && end > root.length + 1 && isSeparator(engine, path[end - 1])) end -= 1;
  let last = -1;
  for (let index = end - 1; index >= 1; index -= 1) {
    if (isSeparator(engine, path[index])) {
      last = index;
      break;
    }
  }
  if (last < root.length) {
    if (root.length > 0) return root;
    return isAbsoluteWith(path, engine) ? engine.sep : ".";
  }
  const parent = path.slice(0, last);
  if (engine.win32 && /^[A-Za-z]:$/.test(parent)) return `${parent}\\`;
  if (parent.length === 0) return engine.sep;
  return parent;
}
function basenameWith(path, engine, suffix) {
  let base = path;
  while (base.length > 1 && isSeparator(engine, base[base.length - 1])) base = base.slice(0, -1);
  let start = 0;
  for (let index = base.length - 1; index >= 0; index -= 1) {
    if (isSeparator(engine, base[index])) {
      start = index + 1;
      break;
    }
  }
  let result = base.slice(start);
  if (typeof suffix === "string" && suffix.length > 0 && result.endsWith(suffix) && result.length > suffix.length) {
    result = result.slice(0, result.length - suffix.length);
  }
  return result;
}
function extnameWith(path, engine) {
  const base = basenameWith(path, engine);
  if (base.startsWith(".") && base.length === 1) return "";
  for (let index = base.length - 1; index > 0; index -= 1) {
    if (base[index] === ".") return base.slice(index);
  }
  return "";
}
function relativeWith(from, to, engine) {
  const fromResolved = resolveWith([from], engine);
  const toResolved = resolveWith([to], engine);
  if (fromResolved === toResolved) return "";
  const fromSegments = fromResolved.split(sepClass(engine));
  const toSegments = toResolved.split(sepClass(engine));
  const shared = Math.min(fromSegments.length, toSegments.length);
  let offset = 0;
  while (offset < shared && fromSegments[offset] === toSegments[offset]) offset += 1;
  const ups = fromSegments.length - offset;
  const downs = toSegments.slice(offset);
  if (ups === 0) return downs.join(engine.sep);
  const up = "..".repeat(ups);
  return downs.length === 0 ? up : `${up}${engine.sep}${downs.join(engine.sep)}`;
}
function parseWith(path, engine) {
  if (path.length === 0) throw new QuickJsShimError(SHIM_ERROR_CODES.signatureUnsupported, "path.parse expects a non-empty string.");
  const root = path.slice(0, rootLength(path, engine));
  const dir = path === root ? "" : dirnameWith(path, engine);
  const base = basenameWith(path, engine);
  const ext = extnameWith(base, engine);
  const name = base.slice(0, base.length - ext.length);
  return { root, dir: dir.length === 0 ? root : dir, base, ext, name };
}
function formatWith(parsed, engine) {
  const dir = parsed["dir"] ?? parsed["root"] ?? "";
  const base = parsed["base"] ?? `${parsed["name"] ?? ""}${parsed["ext"] ?? ""}`;
  if (base.length === 0) return dir;
  if (dir.length === 0) return base;
  return dir.endsWith(engine.sep) || engine.win32 && dir.endsWith("\\") ? `${dir}${base}` : `${dir}${engine.sep}${base}`;
}
function engineApi(engine) {
  return {
    sep: engine.sep,
    delimiter: engine.delimiter,
    normalize: (path) => normalizeWith(path, engine),
    join: (...parts) => {
      const kept = parts.filter((part) => typeof part === "string" && part.length > 0);
      if (kept.length === 0) return ".";
      return normalizeWith(kept.join(engine.sep), engine);
    },
    resolve: (...parts) => resolveWith(parts, engine),
    isAbsolute: (path) => isAbsoluteWith(path, engine),
    relative: (from, to) => relativeWith(from, to, engine),
    dirname: (path) => dirnameWith(path, engine),
    basename: (path, suffix) => basenameWith(path, engine, suffix),
    extname: (path) => extnameWith(path, engine),
    parse: (path) => parseWith(path, engine),
    format: (parsed) => formatWith(parsed, engine),
    toNamespacedPath: (path) => path
  };
}
var enginePosix = engineApi(posixEngine);
var engineWin32 = engineApi(win32Engine);
var sep = platformInfoOrFallback().sep;
var delimiter = platformInfoOrFallback().pathSep;
function join(...parts) {
  for (const part of parts) {
    if (typeof part !== "string") throw new QuickJsShimError(SHIM_ERROR_CODES.signatureUnsupported, `path.join expects strings, got ${typeof part}.`);
  }
  return joinPathsMatch(parts);
}
var resolve = (...parts) => resolveWith(parts, native());
var relative = (from, to) => relativeWith(from, to, native());
var dirname = (path) => dirnameWith(path, native());
var basename = (path, suffix) => basenameWith(path, native(), suffix);
var extname = (path) => extnameWith(path, native());
var _makeLong = notImplemented("path", "_makeLong");

// packages/nodes/gifu/src/platform.ts
var SEVEN_ZIP_NAMES = ["7z", "7zz", "7za", "7z.exe", "7zz.exe", "7za.exe"];
var FFMPEG_NAMES = ["ffmpeg", "ffmpeg.exe"];
var FFPROBE_NAMES = ["ffprobe", "ffprobe.exe"];
function createNodeGifuRuntime() {
  const children = /* @__PURE__ */ new Set();
  let cancelled = false;
  let sevenZipPromise;
  let ffmpegPromise;
  let ffprobePromise;
  const trackedCommand = (command, args, options = {}) => runCommand(command, args, { ...options, children });
  return {
    readText: (path) => readFile(path, "utf8"),
    appendRecord,
    pathInfo,
    listDir,
    async listArchiveImages(path) {
      cancelled = false;
      sevenZipPromise ??= findSevenZip();
      const sevenZip = await sevenZipPromise;
      if (!sevenZip) throw new Error("7-Zip was not found. Install 7-Zip or add 7z to PATH.");
      const result = await trackedCommand(sevenZip, ["l", "-slt", "-ba", path], { maxBuffer: 64 * 1024 * 1024 });
      if (result.code !== 0) throw new Error(result.stderr || result.stdout || `7-Zip exited with code ${result.code}.`);
      return parse7zImageEntries(result.stdout);
    },
    async convertArchive(task) {
      if (cancelled) throw new Error("Conversion cancelled.");
      sevenZipPromise ??= findSevenZip();
      ffmpegPromise ??= findFfmpeg();
      ffprobePromise ??= findFfprobe(await ffmpegPromise);
      const [sevenZip, ffmpeg, ffprobe] = await Promise.all([sevenZipPromise, ffmpegPromise, ffprobePromise]);
      if (!sevenZip) throw new Error("7-Zip was not found. Install 7-Zip or add 7z to PATH.");
      if (!ffmpeg) throw new Error("ffmpeg was not found. Install ffmpeg or add it to PATH.");
      if (!ffprobe) throw new Error("ffprobe was not found next to ffmpeg or on PATH.");
      return convertArchive(task, { sevenZip, ffmpeg, ffprobe, run: trackedCommand, isCancelled: () => cancelled });
    },
    cancel() {
      cancelled = true;
      for (const child of children) child.kill();
    },
    isCancelled: () => cancelled,
    join,
    dirname,
    basename,
    extname,
    relative
  };
}
function parse7zImageEntries(text) {
  const entries = [];
  let record = {};
  function flush() {
    const path = record.Path?.trim();
    const folder = record.Folder === "+" || /D/.test(record.Attributes ?? "") || path?.endsWith("/") || path?.endsWith("\\");
    if (path && !folder && isGifuImage(path)) {
      entries.push({
        path: path.replace(/\\/g, "/"),
        extension: extname(path).toLowerCase(),
        size: numberOrUndefined(record.Size)
      });
    }
    record = {};
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }
    const match = /^([^=]+?)\s*=\s*(.*)$/.exec(line);
    if (match) record[match[1].trim()] = match[2];
  }
  flush();
  return entries;
}
async function convertArchive(task, tools) {
  const workspace = await mkdtemp(join(tmpdir(), "xiranite-gifu-"));
  const extractedRoot = join(workspace, "archive");
  const framesRoot = join(workspace, "frames");
  try {
    await mkdir(extractedRoot, { recursive: true });
    const extraction = await tools.run(tools.sevenZip, ["x", "-y", `-o${extractedRoot}`, task.archivePath], { maxBuffer: 64 * 1024 * 1024 });
    if (extraction.code !== 0) throw new Error(extraction.stderr || extraction.stdout || `7-Zip extraction exited with code ${extraction.code}.`);
    if (tools.isCancelled()) throw new Error("Conversion cancelled.");
    const extractedImages = [];
    for (const entry of task.images) {
      const candidate = safeExtractedPath(extractedRoot, entry.path);
      if (candidate && await isFile(candidate)) extractedImages.push({ entry, path: candidate });
    }
    if (extractedImages.length === 1 && task.extractSingle) {
      const outputPath = replaceExtension(task.outputPath, extractedImages[0].entry.extension);
      await assertWritableOutput(outputPath, task.overwrite);
      await mkdir(dirname(outputPath), { recursive: true });
      await copyFile(extractedImages[0].path, outputPath);
      return {
        status: "extracted",
        outputPath,
        decodedFrames: 1,
        skippedFrames: 0,
        encoder: "7z-copy",
        message: "Extracted the single image without re-encoding it."
      };
    }
    if (extractedImages.length < 2) {
      return {
        status: "skipped",
        outputPath: task.outputPath,
        decodedFrames: extractedImages.length,
        skippedFrames: Math.max(0, task.images.length - extractedImages.length),
        encoder: "none",
        message: "Fewer than two extractable image entries remain."
      };
    }
    const probed = [];
    let skippedFrames = task.images.length - extractedImages.length;
    for (const image of extractedImages) {
      if (tools.isCancelled()) throw new Error("Conversion cancelled.");
      const dimensions = await probeImage(tools.ffprobe, image.path, tools.run);
      if (dimensions) probed.push({ path: image.path, ...dimensions });
      else skippedFrames += 1;
    }
    if (probed.length < 2) {
      return {
        status: "skipped",
        outputPath: task.outputPath,
        decodedFrames: probed.length,
        skippedFrames,
        encoder: "none",
        message: "Fewer than two decodable image frames remain."
      };
    }
    let width = Math.max(...probed.map((item) => item.width));
    let height = Math.max(...probed.map((item) => item.height));
    if (task.format === "webm" || task.format === "mp4") {
      if (width % 2) width += 1;
      if (height % 2) height += 1;
    }
    await mkdir(framesRoot, { recursive: true });
    const resizeFlags = task.format === "webm" || task.format === "mp4" ? "bilinear" : "lanczos";
    let decodedFrames = 0;
    for (const image of probed) {
      if (tools.isCancelled()) throw new Error("Conversion cancelled.");
      const framePath = join(framesRoot, `frame-${String(decodedFrames).padStart(8, "0")}.png`);
      const result = await tools.run(tools.ffmpeg, [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        image.path,
        "-map",
        "0:v:0",
        "-frames:v",
        "1",
        "-vf",
        `scale=${width}:${height}:flags=${resizeFlags},format=rgba`,
        framePath
      ]);
      if (result.code === 0 && await isNonEmptyFile(framePath)) decodedFrames += 1;
      else skippedFrames += 1;
    }
    if (decodedFrames < 2) {
      return {
        status: "skipped",
        outputPath: task.outputPath,
        decodedFrames,
        skippedFrames,
        encoder: "none",
        message: "Fewer than two frames could be normalized."
      };
    }
    await assertWritableOutput(task.outputPath, task.overwrite);
    await mkdir(dirname(task.outputPath), { recursive: true });
    const encode = await encodeAnimation(task, tools.ffmpeg, framesRoot, decodedFrames, tools.run);
    if (encode.result.code !== 0) {
      await rm(task.outputPath, { force: true }).catch(() => void 0);
      throw new Error(encode.result.stderr || encode.result.stdout || `${encode.encoder} exited with code ${encode.result.code}.`);
    }
    if (!await isNonEmptyFile(task.outputPath)) throw new Error(`Encoder created an empty output: ${task.outputPath}`);
    return {
      status: "converted",
      outputPath: task.outputPath,
      decodedFrames,
      skippedFrames,
      encoder: encode.encoder,
      message: `Encoded ${decodedFrames} frame(s) with ${encode.encoder}.`
    };
  } finally {
    await rm(workspace, { recursive: true, force: true }).catch(() => void 0);
  }
}
async function encodeAnimation(task, ffmpeg, framesRoot, frameCount, run) {
  const fps = (1e3 / task.durationMs).toFixed(6);
  const input = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    ...task.ffmpegThreads > 0 ? ["-threads", String(task.ffmpegThreads)] : [],
    "-framerate",
    fps,
    "-start_number",
    "0",
    "-i",
    join(framesRoot, "frame-%08d.png"),
    "-frames:v",
    String(frameCount),
    "-an"
  ];
  if (task.format === "gif") {
    const args = [
      ...input,
      "-filter_complex",
      "[0:v]split[a][b];[a]palettegen=stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a",
      "-loop",
      String(task.loop),
      task.outputPath
    ];
    return { encoder: "ffmpeg-gif", result: await run(ffmpeg, args) };
  }
  if (task.format === "webp") {
    const args = [
      ...input,
      "-c:v",
      "libwebp_anim",
      "-lossless",
      "0",
      "-q:v",
      String(task.quality),
      "-compression_level",
      String(task.webpMethod),
      "-loop",
      String(task.loop),
      task.outputPath
    ];
    return { encoder: "libwebp_anim", result: await run(ffmpeg, args) };
  }
  if (task.format === "apng") {
    const args = [...input, "-plays", String(task.loop), "-f", "apng", task.outputPath];
    return { encoder: "ffmpeg-apng", result: await run(ffmpeg, args) };
  }
  if (task.format === "webm") {
    const args = [
      ...input,
      "-vsync",
      "0",
      "-c:v",
      "libvpx-vp9",
      "-pix_fmt",
      "yuv420p",
      "-b:v",
      "0",
      "-crf",
      String(task.webmCrf),
      "-deadline",
      "realtime",
      "-cpu-used",
      String(task.webmCpuUsed),
      "-row-mt",
      "1",
      task.outputPath
    ];
    return { encoder: "libvpx-vp9", result: await run(ffmpeg, args) };
  }
  const nvencArgs = [
    ...input,
    "-vsync",
    "0",
    "-c:v",
    "av1_nvenc",
    "-rc",
    "vbr",
    "-b:v",
    "0",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    task.mp4Preset,
    "-cq:v",
    String(task.mp4Cq),
    task.outputPath
  ];
  const nvenc = await run(ffmpeg, nvencArgs);
  if (nvenc.code === 0) return { encoder: "av1_nvenc", result: nvenc };
  await rm(task.outputPath, { force: true }).catch(() => void 0);
  const softwareArgs = [
    ...input,
    "-vsync",
    "0",
    "-c:v",
    "libaom-av1",
    "-b:v",
    "0",
    "-crf",
    String(task.mp4Cq),
    "-cpu-used",
    "6",
    "-pix_fmt",
    "yuv420p",
    task.outputPath
  ];
  return { encoder: "libaom-av1", result: await run(ffmpeg, softwareArgs) };
}
async function probeImage(ffprobe, path, run) {
  const result = await run(ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", path]);
  if (result.code !== 0) return null;
  try {
    const parsed = JSON.parse(result.stdout);
    const stream = parsed.streams?.[0];
    return stream && Number(stream.width) > 0 && Number(stream.height) > 0 ? { width: Number(stream.width), height: Number(stream.height) } : null;
  } catch {
    return null;
  }
}
async function pathInfo(path) {
  try {
    const info = await stat(path);
    return { path: resolve(path), exists: true, isFile: info.isFile(), isDirectory: info.isDirectory() };
  } catch {
    return { path, exists: false, isFile: false, isDirectory: false };
  }
}
async function listDir(path) {
  const entries = await readdir(path, { withFileTypes: true });
  return entries.map((entry) => ({ name: entry.name, path: join(path, entry.name), isFile: entry.isFile(), isDirectory: entry.isDirectory() }));
}
async function appendRecord(path, record) {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(record)}
`, "utf8");
}
async function findSevenZip() {
  const configured = process.env.GIFU_7Z?.trim();
  if (configured && await exists(configured)) return configured;
  const found = await findExecutable(SEVEN_ZIP_NAMES);
  if (found) return found;
  for (const candidate of [
    "C:\\Program Files\\7-Zip\\7z.exe",
    "C:\\Program Files (x86)\\7-Zip\\7z.exe",
    join(process.env.LOCALAPPDATA ?? "", "7-Zip", "7z.exe")
  ]) if (candidate && await exists(candidate)) return candidate;
  return null;
}
async function findFfmpeg() {
  const configured = process.env.GIFU_FFMPEG?.trim();
  if (configured && await exists(configured)) return configured;
  return findExecutable(FFMPEG_NAMES);
}
async function findFfprobe(ffmpeg) {
  const configured = process.env.GIFU_FFPROBE?.trim();
  if (configured && await exists(configured)) return configured;
  if (ffmpeg) {
    const sibling = join(dirname(ffmpeg), process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
    if (await exists(sibling)) return sibling;
  }
  return findExecutable(FFPROBE_NAMES);
}
async function findExecutable(names) {
  const locator = process.platform === "win32" ? "where.exe" : "which";
  for (const name of names) {
    const result = await runCommand(locator, [name]);
    if (result.code === 0) {
      const found = result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
      if (found) return found;
    }
  }
  return null;
}
async function runCommand(command, args, options = {}) {
  return new Promise((resolveResult) => {
    const child = execFile(command, args, {
      cwd: options.cwd,
      encoding: "utf8",
      maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024,
      windowsHide: true
    }, (error, stdout, stderr) => {
      options.children?.delete(child);
      const rawCode = error?.code;
      const code = typeof rawCode === "number" ? rawCode : error ? 1 : 0;
      resolveResult({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? (error instanceof Error ? error.message : "")) });
    });
    options.children?.add(child);
  });
}
function safeExtractedPath(root, entryPath) {
  const candidate = resolve(root, entryPath.replace(/[\\/]/g, sep));
  const rel = relative(root, candidate);
  if (rel === ".." || rel.startsWith(`..${sep}`) || resolve(rel) === rel) return null;
  return candidate;
}
function replaceExtension(path, extension) {
  const normalized = extension.startsWith(".") ? extension : `.${extension}`;
  return path.slice(0, path.length - extname(path).length) + normalized;
}
async function assertWritableOutput(path, overwrite) {
  if (!overwrite && await exists(path)) throw new Error(`Output already exists: ${path}`);
}
async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
async function isNonEmptyFile(path) {
  try {
    const info = await stat(path);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}
async function exists(path) {
  try {
    await access(path, constants2.F_OK);
    return true;
  } catch {
    return false;
  }
}
function numberOrUndefined(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : void 0;
}
export {
  createNodeGifuRuntime,
  runGifu
};
