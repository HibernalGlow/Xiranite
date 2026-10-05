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
    const first = bytes[index];
    if (first < 128) {
      output += String.fromCharCode(first);
      index += 1;
      continue;
    }
    let codePoint;
    if ((first & 224) === 192) {
      codePoint = (first & 31) << 6 | bytes[index + 1] & 63;
      index += 2;
    } else if ((first & 240) === 224) {
      codePoint = (first & 15) << 12 | (bytes[index + 1] & 63) << 6 | bytes[index + 2] & 63;
      index += 3;
    } else {
      codePoint = (first & 7) << 18 | (bytes[index + 1] & 63) << 12 | (bytes[index + 2] & 63) << 6 | bytes[index + 3] & 63;
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
var atob = (encoded) => bytesToLatin1(bytesFromHostPayload(encoded));
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
function opHomedir() {
  return String(hostCall("os.homedir", {}));
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

// packages/nodes/dissolvef/src/core.ts
var DISSOLVEF_VIDEO_EXTENSIONS = [".mp4", ".nov", ".avi", ".mkv", ".wmv", ".flv", ".webm", ".mov", ".m4v", ".mpg", ".mpeg", ".3gp", ".rmvb"];
var DISSOLVEF_ARCHIVE_EXTENSIONS = [".zip", ".rar", ".7z", ".cbz", ".cbr"];
var DISSOLVEF_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif", ".bmp", ".tif", ".tiff"];
var DISSOLVEF_SINGLE_ARCHIVE_BLACKLIST = ["\u753B\u96C6", "\u5546\u4E1A\u5FD7", "\u540C\u4EBA\u5FD7", "#compare"];
var DISSOLVEF_NESTED_BLACKLIST = [...DISSOLVEF_SINGLE_ARCHIVE_BLACKLIST, "CG", "pixiv", "fan", "patreon"];
function normalizeDissolvefInput(input) {
  const action = input.action ?? "dissolve";
  const direct = input.direct ?? action === "direct";
  return {
    action,
    path: clean(input.path),
    nested: input.nested ?? (!direct && action !== "media" && action !== "archive"),
    media: input.media ?? (!direct && action !== "nested" && action !== "archive"),
    archive: input.archive ?? (!direct && action !== "nested" && action !== "media"),
    direct,
    preview: Boolean(input.preview ?? input.dryRun),
    exclude: parseList(input.exclude),
    fileConflict: input.fileConflict ?? input.file_conflict ?? "auto",
    dirConflict: input.dirConflict ?? input.dir_conflict ?? "auto",
    similarityThreshold: clampNumber(input.similarityThreshold ?? input.similarity_threshold, 0.6, 0, 1),
    enableSimilarity: input.enableSimilarity ?? input.enable_similarity ?? true,
    protectFirstLevel: input.protectFirstLevel ?? input.protect_first_level ?? true,
    undoId: clean(input.undoId ?? input.undo_id),
    historyPath: clean(input.historyPath),
    historyLimit: Math.max(1, Math.trunc(input.historyLimit ?? 20)),
    mediaTypes: input.mediaTypes?.length ? [...new Set(input.mediaTypes)] : ["video", "archive", "image"],
    skipBlacklist: input.skipBlacklist ?? false
  };
}
async function runDissolvef(input, runtime, onEvent = () => {
}) {
  const normalized = normalizeDissolvefInput(input);
  try {
    if (normalized.action === "history") return await history(normalized, runtime);
    if (normalized.action === "undo") return await undo(normalized, runtime, onEvent);
    if (normalized.action === "collect_archives") {
      const archivePaths = await collectSingleArchivePaths(normalized, runtime);
      return success(`Collected ${archivePaths.length} archive path(s).`, { archivePaths });
    }
    const plan = await buildDissolvefPlan(normalized, runtime);
    if (normalized.action === "plan" || normalized.preview) {
      return success(`Plan generated: ${plan.filter((item) => item.status === "pending").length} operation(s).`, dataFromPlan(plan));
    }
    return await executePlan(normalized, plan, runtime, onEvent);
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error));
  }
}
async function buildDissolvefPlan(input, runtime) {
  if (!input.path) throw new Error("Path is required.");
  const root = await runtime.pathInfo(input.path);
  if (!root.exists) throw new Error(`Path does not exist: ${input.path}`);
  if (!root.isDirectory) throw new Error(`Path is not a directory: ${input.path}`);
  if (input.direct || input.action === "direct") return await planDirect(root.path, input, runtime);
  const plan = [];
  const blockedPaths = [];
  for (const mode of selectedDissolveModes(input)) {
    const raw = mode === "media" ? await planMedia(root.path, input, runtime) : mode === "nested" ? await planNested(root.path, input, runtime) : await planArchive(root.path, input, runtime);
    const accepted = filterBlockedGroups(raw, blockedPaths);
    plan.push(...accepted);
    blockedPaths.push(...accepted.filter((item) => item.operation === "delete_dir" && item.status === "pending").map((item) => item.sourcePath));
  }
  return plan;
}
async function collectSingleArchivePaths(input, runtime) {
  const plan = await planArchive((await runtime.pathInfo(input.path)).path, input, runtime);
  return [...new Set(plan.filter((item) => item.operation === "move" && item.status === "pending").map((item) => item.sourcePath))].sort((a, b) => a.localeCompare(b));
}
function isDissolvefArchive(path) {
  return hasExtension(path, DISSOLVEF_ARCHIVE_EXTENSIONS);
}
function isDissolvefVideo(path) {
  return hasExtension(path, DISSOLVEF_VIDEO_EXTENSIONS);
}
function isDissolvefImage(path) {
  return hasExtension(path, DISSOLVEF_IMAGE_EXTENSIONS);
}
function calculateDissolvefSimilarity(left, right) {
  const a = normalizeName(left);
  const b = normalizeName(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ratio = levenshteinRatio(a, b);
  const partial = a.includes(b) || b.includes(a) ? Math.min(a.length, b.length) / Math.max(a.length, b.length) : 0;
  const tokenSort = levenshteinRatio(sortTokens(a), sortTokens(b));
  const tokenSet = tokenSetRatio(a, b);
  return Math.max(ratio, partial, tokenSort, tokenSet);
}
function checkDissolvefSimilarity(parentName, childName, threshold = 0.6) {
  if (threshold <= 0) return { passed: true, similarity: 1 };
  const similarity = calculateDissolvefSimilarity(parentName, childName);
  return { passed: similarity >= threshold, similarity };
}
function parseDissolveHistory(content) {
  if (!content?.trim()) return [];
  try {
    const parsed = JSON.parse(content);
    const records = Array.isArray(parsed) ? parsed : [parsed];
    return records.map(normalizeUndoRecord).filter((record) => record !== null);
  } catch {
    return [];
  }
}
function dumpDissolveHistory(records) {
  return `${JSON.stringify(records, null, 2)}
`;
}
async function planNested(rootPath, input, runtime) {
  const plan = [];
  const dirs = (await collectDirectoryPaths(rootPath, runtime)).sort((a, b) => pathDepth(a) - pathDepth(b));
  const covered = [];
  for (const dir of dirs) {
    if (covered.some((path) => isSameOrInside(dir, path))) continue;
    if (input.protectFirstLevel && isFirstLevel(rootPath, dir, runtime)) continue;
    const skipReason = skipReasonForPath(dir, input.exclude, input.skipBlacklist ? [] : DISSOLVEF_NESTED_BLACKLIST);
    if (skipReason) {
      plan.push(skipped("nested", dir, skipReason));
      continue;
    }
    const entries = await sortedEntries(dir, runtime);
    const childDirs = entries.filter((entry) => entry.isDirectory);
    const files = entries.filter((entry) => entry.isFile);
    if (childDirs.length !== 1 || files.length !== 0) continue;
    const firstChild = childDirs[0];
    const similarity = input.enableSimilarity ? checkDissolvefSimilarity(runtime.basename(dir), firstChild.name, input.similarityThreshold) : { passed: true, similarity: 1 };
    if (!similarity.passed) {
      plan.push(skipped("nested", firstChild.path, "similarity_below_threshold", similarity.similarity));
      continue;
    }
    const deepest = await deepestSingleSubfolder(firstChild.path, runtime);
    const deepestEntries = await sortedEntries(deepest, runtime);
    for (const item of deepestEntries) {
      const targetPath = await nextAvailablePath(runtime.join(dir, item.name), runtime);
      plan.push({
        mode: "nested",
        operation: "move",
        sourcePath: item.path,
        targetPath,
        itemKind: item.isDirectory ? "directory" : "file",
        status: "pending",
        similarity: similarity.similarity
      });
    }
    plan.push({
      mode: "nested",
      operation: "delete_dir",
      sourcePath: firstChild.path,
      targetPath: "",
      itemKind: "directory",
      status: "pending",
      recursiveDelete: true,
      similarity: similarity.similarity
    });
    covered.push(firstChild.path);
  }
  return plan;
}
async function planMedia(rootPath, input, runtime) {
  const plan = [];
  const dirs = (await collectDirectoryPaths(rootPath, runtime)).sort((a, b) => pathDepth(b) - pathDepth(a));
  for (const dir of dirs) {
    if (input.protectFirstLevel && isFirstLevel(rootPath, dir, runtime)) continue;
    const skipReason = skipReasonForPath(dir, input.exclude, []);
    if (skipReason) {
      plan.push(skipped("media", dir, skipReason));
      continue;
    }
    const entries = await sortedEntries(dir, runtime);
    const files = entries.filter((entry) => entry.isFile);
    const childDirs = entries.filter((entry) => entry.isDirectory);
    const mediaFiles = files.filter((entry) => isEnabledMedia(entry.name, input.mediaTypes));
    if (mediaFiles.length !== 1 || files.length !== 1 || childDirs.length !== 0) continue;
    const mediaFile = mediaFiles[0];
    const targetPath = await nextAvailablePath(runtime.join(runtime.dirname(dir), mediaFile.name), runtime);
    plan.push({
      mode: "media",
      operation: "move",
      sourcePath: mediaFile.path,
      targetPath,
      itemKind: "file",
      status: "pending"
    });
    plan.push({
      mode: "media",
      operation: "delete_dir",
      sourcePath: dir,
      targetPath: "",
      itemKind: "directory",
      status: "pending"
    });
  }
  return plan;
}
async function planArchive(rootPath, input, runtime) {
  const plan = [];
  const dirs = (await collectDirectoryPaths(rootPath, runtime)).sort((a, b) => pathDepth(b) - pathDepth(a));
  for (const dir of dirs) {
    if (input.protectFirstLevel && isFirstLevel(rootPath, dir, runtime)) continue;
    const skipReason = skipReasonForPath(dir, input.exclude, input.skipBlacklist ? [] : DISSOLVEF_SINGLE_ARCHIVE_BLACKLIST);
    if (skipReason) {
      plan.push(skipped("archive", dir, skipReason));
      continue;
    }
    const entries = await sortedEntries(dir, runtime);
    const files = entries.filter((entry) => entry.isFile);
    const childDirs = entries.filter((entry) => entry.isDirectory);
    const archiveFiles = files.filter((entry) => isDissolvefArchive(entry.name));
    if (archiveFiles.length !== 1 || files.length !== 1 || childDirs.length !== 0) continue;
    const archive = archiveFiles[0];
    const similarity = input.enableSimilarity ? checkDissolvefSimilarity(runtime.basename(dir), stripExtension(archive.name), input.similarityThreshold) : { passed: true, similarity: 1 };
    if (!similarity.passed) {
      plan.push(skipped("archive", archive.path, "similarity_below_threshold", similarity.similarity));
      continue;
    }
    const targetPath = await nextAvailablePath(runtime.join(runtime.dirname(dir), archive.name), runtime);
    plan.push({
      mode: "archive",
      operation: "move",
      sourcePath: archive.path,
      targetPath,
      itemKind: "file",
      status: "pending",
      similarity: similarity.similarity
    });
    plan.push({
      mode: "archive",
      operation: "delete_dir",
      sourcePath: dir,
      targetPath: "",
      itemKind: "directory",
      status: "pending",
      similarity: similarity.similarity
    });
  }
  return plan;
}
async function planDirect(rootPath, input, runtime) {
  const plan = [];
  const parent = runtime.dirname(rootPath);
  for (const entry of await sortedEntries(rootPath, runtime)) {
    await appendDirectMove(plan, entry, parent, input, runtime);
  }
  plan.push({
    mode: "direct",
    operation: "delete_dir",
    sourcePath: rootPath,
    targetPath: "",
    itemKind: "directory",
    status: "pending"
  });
  return plan;
}
async function appendDirectMove(plan, entry, targetDir, input, runtime) {
  const targetPath = runtime.join(targetDir, entry.name);
  if (entry.isDirectory) {
    const targetInfo = await runtime.pathInfo(targetPath);
    const conflict = normalizeConflict(input.dirConflict, true);
    if (targetInfo.exists && targetInfo.isDirectory && conflict === "overwrite") {
      for (const child of await sortedEntries(entry.path, runtime)) {
        await appendDirectMove(plan, child, targetPath, input, runtime);
      }
      plan.push({
        mode: "direct",
        operation: "delete_dir",
        sourcePath: entry.path,
        targetPath: "",
        itemKind: "directory",
        status: "pending"
      });
      return;
    }
  }
  const resolved = await resolveConflictTarget(targetPath, entry.isDirectory, entry.isDirectory ? input.dirConflict : input.fileConflict, runtime);
  if (!resolved.proceed) {
    plan.push({
      mode: "direct",
      operation: "move",
      sourcePath: entry.path,
      targetPath,
      itemKind: entry.isDirectory ? "directory" : "file",
      status: "skipped",
      reason: resolved.reason
    });
    return;
  }
  plan.push({
    mode: "direct",
    operation: "move",
    sourcePath: entry.path,
    targetPath: resolved.targetPath,
    itemKind: entry.isDirectory ? "directory" : "file",
    status: "pending",
    deleteTarget: resolved.deleteTarget
  });
}
function moveTargetParent(item, runtime) {
  return item.operation === "delete_dir" || !item.targetPath ? void 0 : runtime.dirname(item.targetPath);
}
async function targetsReachable(parents, runtime) {
  for (const parent of [...new Set(parents.filter((value) => Boolean(value)))]) {
    try {
      await runtime.ensureDir(parent);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }
  return void 0;
}
async function executePlan(input, plan, runtime, onEvent) {
  const pending = plan.filter((item) => item.status === "pending");
  const completed = [];
  let successCount = 0;
  let failedCount = 0;
  const refusal = await targetsReachable(pending.map((item) => moveTargetParent(item, runtime)), runtime);
  if (refusal) {
    const blocked = pending.map((item) => ({ ...item, status: "error", reason: refusal }));
    return {
      success: false,
      message: `Dissolve aborted before any change: ${refusal}`,
      data: data(dataFromPlan([...plan.filter((item) => item.status === "skipped"), ...blocked]))
    };
  }
  for (let index = 0; index < pending.length; index += 1) {
    const item = pending[index];
    onEvent({ type: "progress", progress: Math.round(index / Math.max(pending.length, 1) * 100), message: item.sourcePath });
    try {
      if (item.operation === "delete_dir") {
        await runtime.deletePath(item.sourcePath, item.recursiveDelete);
      } else {
        if (item.deleteTarget) await runtime.deletePath(item.targetPath);
        await runtime.movePath(item.sourcePath, item.targetPath);
      }
      completed.push({ ...item, status: "success" });
      successCount += 1;
    } catch (error) {
      completed.push({ ...item, status: "error", reason: error instanceof Error ? error.message : String(error) });
      failedCount += 1;
    }
  }
  const skipped2 = plan.filter((item) => item.status === "skipped");
  const operationId = await recordUndoIfNeeded(input, completed, runtime);
  const finalPlan = [...skipped2, ...completed];
  onEvent({ type: "progress", progress: 100, message: "Dissolve completed." });
  return {
    success: failedCount === 0,
    message: `Dissolve completed: ${successCount} success, ${skipped2.length} skipped, ${failedCount} failed.`,
    data: data({
      ...dataFromPlan(finalPlan),
      plan: finalPlan,
      successCount,
      failedCount,
      operationId
    })
  };
}
async function recordUndoIfNeeded(input, completed, runtime) {
  const operations = completed.filter((item) => item.status === "success").map((item) => item.operation === "move" ? { type: "move", sourcePath: item.sourcePath, targetPath: item.targetPath } : { type: "delete_dir", sourcePath: item.sourcePath });
  if (!operations.length) return "";
  const modes = [...new Set(completed.filter((item) => item.status === "success").map((item) => item.mode))];
  const record = {
    id: `dissolve-${runtime.now().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${runtime.randomId()}`,
    timestamp: runtime.now().toISOString(),
    mode: modes.length === 1 ? modes[0] : "mixed",
    path: input.path,
    count: operations.length,
    operations
  };
  const records = parseDissolveHistory(await runtime.readText(historyPath(input, runtime)));
  records.unshift(record);
  await runtime.writeText(historyPath(input, runtime), dumpDissolveHistory(records.slice(0, 100)));
  return record.id;
}
async function history(input, runtime) {
  const records = parseDissolveHistory(await runtime.readText(historyPath(input, runtime))).slice(0, input.historyLimit);
  return success(`Loaded ${records.length} history record(s).`, { history: records });
}
async function undo(input, runtime, onEvent) {
  const path = historyPath(input, runtime);
  const records = parseDissolveHistory(await runtime.readText(path));
  const record = input.undoId ? records.find((item) => item.id === input.undoId) : records.find((item) => !item.undone);
  if (!record) return failure(input.undoId ? `Undo record not found: ${input.undoId}` : "No undoable record found.");
  if (record.undone) return failure(`Undo record already applied: ${record.id}`);
  let successCount = 0;
  let failedCount = 0;
  const errors = [];
  const operations = [...record.operations].reverse();
  const unreachable = await targetsReachable(
    operations.map(
      (operation) => operation.type === "delete_dir" ? operation.sourcePath : operation.targetPath ? runtime.dirname(operation.sourcePath) : void 0
    ),
    runtime
  );
  if (unreachable) return failure(`Undo aborted before any change: ${unreachable}`);
  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index];
    onEvent({ type: "progress", progress: Math.round(index / Math.max(operations.length, 1) * 100), message: operation.sourcePath });
    try {
      if (operation.type === "delete_dir") {
        await runtime.ensureDir(operation.sourcePath);
      } else if (operation.targetPath) {
        const [source, target] = await Promise.all([
          runtime.pathInfo(operation.sourcePath),
          runtime.pathInfo(operation.targetPath)
        ]);
        if (source.exists && target.exists) {
          throw new Error(`Undo conflict: both source and target exist: ${operation.sourcePath}`);
        }
        if (source.exists) {
          successCount += 1;
          continue;
        }
        if (!target.exists) {
          throw new Error(`Undo source is missing: ${operation.targetPath}`);
        }
        await runtime.ensureDir(runtime.dirname(operation.sourcePath));
        await runtime.movePath(operation.targetPath, operation.sourcePath);
      }
      successCount += 1;
    } catch (error) {
      failedCount += 1;
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  record.undone = failedCount === 0;
  await runtime.writeText(path, dumpDissolveHistory(records));
  onEvent({ type: "progress", progress: 100, message: "Undo completed." });
  return {
    success: failedCount === 0,
    message: `Undo completed: ${successCount} success, ${failedCount} failed.`,
    data: data({ history: records, successCount, failedCount, errors })
  };
}
async function collectDirectoryPaths(path, runtime) {
  const result = [path];
  for (const entry of await runtime.listDir(path)) {
    if (entry.isDirectory) result.push(...await collectDirectoryPaths(entry.path, runtime));
  }
  return result;
}
async function deepestSingleSubfolder(path, runtime) {
  let current = path;
  while (true) {
    const entries = await sortedEntries(current, runtime);
    const dirs = entries.filter((entry) => entry.isDirectory);
    const files = entries.filter((entry) => entry.isFile);
    if (dirs.length === 1 && files.length === 0) current = dirs[0].path;
    else return current;
  }
}
async function sortedEntries(path, runtime) {
  return (await runtime.listDir(path)).sort((a, b) => {
    if (a.isFile !== b.isFile) return a.isFile ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
async function resolveConflictTarget(targetPath, isDirectory, conflict, runtime) {
  const info = await runtime.pathInfo(targetPath);
  if (!info.exists) return { proceed: true, targetPath };
  const mode = normalizeConflict(conflict, isDirectory);
  if (mode === "skip") return { proceed: false, targetPath, reason: "target_exists" };
  if (mode === "rename") return { proceed: true, targetPath: await nextAvailablePath(targetPath, runtime) };
  if (isDirectory) {
    if (!info.isDirectory) return { proceed: false, targetPath, reason: "target_file_exists" };
    return { proceed: true, targetPath };
  }
  if (!info.isFile) return { proceed: false, targetPath, reason: "target_directory_exists" };
  return { proceed: true, targetPath, deleteTarget: true };
}
function normalizeConflict(conflict, isDirectory) {
  if (conflict === "auto") return isDirectory ? "overwrite" : "skip";
  return conflict;
}
async function nextAvailablePath(targetPath, runtime) {
  if (!(await runtime.pathInfo(targetPath)).exists) return targetPath;
  const dir = runtime.dirname(targetPath);
  const name = runtime.basename(targetPath);
  const { stem, suffix } = splitName(name);
  for (let counter = 1; counter < 1e4; counter += 1) {
    const candidate = runtime.join(dir, `${stem}_${counter}${suffix}`);
    if (!(await runtime.pathInfo(candidate)).exists) return candidate;
  }
  throw new Error(`Unable to find available target for ${targetPath}`);
}
function skipReasonForPath(path, exclude, blacklist) {
  const lower = path.toLowerCase();
  if (exclude.some((keyword) => keyword && lower.includes(keyword.toLowerCase()))) return "excluded";
  if (blacklist.some((keyword) => keyword && lower.includes(keyword.toLowerCase()))) return "blacklisted";
  return null;
}
function selectedDissolveModes(input) {
  if (input.action === "media" || input.action === "nested" || input.action === "archive") return [input.action];
  const modes = [];
  if (input.media) modes.push("media");
  if (input.nested) modes.push("nested");
  if (input.archive) modes.push("archive");
  return modes;
}
function filterBlockedGroups(plan, blockedPaths) {
  if (!blockedPaths.length) return plan;
  const result = [];
  let group = [];
  function flush() {
    if (!group.length) return;
    const blocked = group.some((item) => blockedPaths.some((path) => {
      if (isSameOrInside(item.sourcePath, path)) return true;
      if (item.operation === "delete_dir" && isSameOrInside(path, item.sourcePath)) return true;
      return false;
    }));
    if (!blocked) result.push(...group);
    group = [];
  }
  for (const item of plan) {
    group.push(item);
    if (item.status === "skipped" || item.operation === "delete_dir") flush();
  }
  flush();
  return result;
}
function skipped(mode, path, reason, similarity) {
  return {
    mode,
    operation: "move",
    sourcePath: path,
    targetPath: "",
    itemKind: "directory",
    status: "skipped",
    reason,
    similarity
  };
}
function isEnabledMedia(name, mediaTypes) {
  return mediaTypes.includes("video") && isDissolvefVideo(name) || mediaTypes.includes("archive") && isDissolvefArchive(name) || mediaTypes.includes("image") && isDissolvefImage(name);
}
function hasExtension(path, extensions) {
  const lower = path.toLowerCase();
  return extensions.some((ext) => lower.endsWith(ext));
}
function pathDepth(path) {
  return path.split(/[\\/]+/).filter(Boolean).length;
}
function isFirstLevel(root, candidate, runtime) {
  return candidate !== root && runtime.dirname(candidate) === root;
}
function isSameOrInside(path, parent) {
  return path === parent || path.startsWith(`${parent}/`) || path.startsWith(`${parent}\\`);
}
function stripExtension(name) {
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(0, index) : name;
}
function splitName(name) {
  const index = name.lastIndexOf(".");
  if (index <= 0) return { stem: name, suffix: "" };
  return { stem: name.slice(0, index), suffix: name.slice(index) };
}
function normalizeName(name) {
  return stripExtension(name).toLowerCase().replace(/[_\-.[\](){}]+/g, " ").replace(/\s+/g, " ").trim();
}
function sortTokens(value) {
  return value.split(/\s+/).filter(Boolean).sort((a, b) => a.localeCompare(b)).join(" ");
}
function tokenSetRatio(left, right) {
  const a = new Set(left.split(/\s+/).filter(Boolean));
  const b = new Set(right.split(/\s+/).filter(Boolean));
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  return 2 * intersection / (a.size + b.size);
}
function levenshteinRatio(left, right) {
  const maxLength = Math.max(left.length, right.length);
  if (maxLength === 0) return 1;
  return 1 - levenshteinDistance(left, right) / maxLength;
}
function levenshteinDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = Array.from({ length: right.length + 1 }, () => 0);
  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    for (let j = 0; j <= right.length; j += 1) previous[j] = current[j];
  }
  return previous[right.length];
}
function historyPath(input, runtime) {
  return input.historyPath || runtime.defaultHistoryPath();
}
function parseList(value) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  return (value ?? "").split(/[,;\r\n]/).map(clean).filter(Boolean);
}
function clean(value) {
  return (value ?? "").trim().replace(/^["']|["']$/g, "");
}
function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
function normalizeUndoRecord(value) {
  if (!value || typeof value !== "object") return null;
  const record = value;
  if (typeof record.id !== "string" || typeof record.timestamp !== "string" || !Array.isArray(record.operations)) return null;
  const operations = record.operations.map(normalizeUndoOperation).filter((operation) => operation !== null);
  if (operations.length !== record.operations.length) return null;
  return {
    id: record.id,
    timestamp: record.timestamp,
    mode: isUndoMode(record.mode) ? record.mode : "mixed",
    path: typeof record.path === "string" ? record.path : "",
    count: typeof record.count === "number" ? record.count : operations.length,
    operations,
    ...typeof record.undone === "boolean" ? { undone: record.undone } : {}
  };
}
function normalizeUndoOperation(value) {
  if (!value || typeof value !== "object") return null;
  const operation = value;
  if (operation.type !== "move" && operation.type !== "delete_dir") return null;
  const sourcePath = typeof operation.sourcePath === "string" ? operation.sourcePath : typeof operation.src === "string" ? operation.src : "";
  if (!sourcePath) return null;
  const targetPath = typeof operation.targetPath === "string" ? operation.targetPath : typeof operation.dst === "string" ? operation.dst : void 0;
  if (operation.type === "move" && !targetPath) return null;
  return targetPath ? { type: operation.type, sourcePath, targetPath } : { type: operation.type, sourcePath };
}
function isUndoMode(value) {
  return value === "nested" || value === "media" || value === "archive" || value === "direct" || value === "mixed";
}
function dataFromPlan(plan) {
  const active = plan.filter((item) => item.status === "pending" || item.status === "success");
  return {
    plan,
    nestedCount: active.filter((item) => item.mode === "nested" && item.operation === "delete_dir").length,
    mediaCount: active.filter((item) => item.mode === "media" && item.operation === "delete_dir").length,
    archiveCount: active.filter((item) => item.mode === "archive" && item.operation === "delete_dir").length,
    directFiles: active.filter((item) => item.mode === "direct" && item.operation === "move" && item.itemKind === "file").length,
    directDirs: active.filter((item) => item.mode === "direct" && item.operation === "move" && item.itemKind === "directory").length,
    skippedCount: plan.filter((item) => item.status === "skipped").length,
    errorCount: plan.filter((item) => item.status === "error").length,
    totalCount: plan.length,
    errors: plan.filter((item) => item.status === "error").map((item) => item.reason ?? "unknown_error")
  };
}
function data(partial) {
  return {
    plan: [],
    history: [],
    archivePaths: [],
    nestedCount: 0,
    mediaCount: 0,
    archiveCount: 0,
    directFiles: 0,
    directDirs: 0,
    skippedCount: 0,
    totalCount: 0,
    successCount: 0,
    failedCount: 0,
    errorCount: 0,
    operationId: "",
    errors: [],
    ...partial
  };
}
function success(message, partial) {
  return { success: true, message, data: data(partial) };
}
function failure(message) {
  return { success: false, message, data: data({ errors: [message], failedCount: 1, errorCount: 1 }) };
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
async function readdir(path, options) {
  const target = toPathString(path, "fs.promises.readdir");
  if (typeof options?.encoding === "string" && options.encoding !== "utf8") {
    throw new QuickJsShimError(SHIM_ERROR_CODES.signatureUnsupported, `fs.readdir: encoding ${JSON.stringify(options.encoding)} is not supported; host list results are UTF-8 names.`);
  }
  const payload = await opFsListAsync(target, { recursive: options?.recursive });
  return toDirentsOrNames(payload.entries ?? [], options?.withFileTypes === true);
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
    const exists = await opFsStatAsync(target).then((info) => info.exists !== false, () => false);
    if (!exists) return;
  }
  await opFsDeleteAsync(target, options?.recursive ?? false);
}
async function rmdir(path) {
  await opFsDeleteAsync(toPathString(path, "fs.promises.rmdir"), false);
}
async function rename(source, destination) {
  await opFsMoveAsync(toPathString(source, "fs.promises.rename"), toPathString(destination, "fs.promises.rename"));
}
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
var dirname = (path) => dirnameWith(path, native());
var basename = (path, suffix) => basenameWith(path, native(), suffix);
var _makeLong = notImplemented("path", "_makeLong");

// packages/quickjs-shims/src/os.ts
function platform() {
  return platformInfo().platform;
}
function arch() {
  return platformInfo().arch;
}
var EOL = platformInfoOrFallback().platform === "win32" ? "\r\n" : "\n";
function homedir() {
  return opHomedir();
}
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

// packages/platform/dist/index.js
function createPlatformContext(input = {}) {
  return {
    platform: input.platform ?? platform(),
    arch: input.arch ?? arch(),
    env: input.env ?? process.env,
    homeDir: input.homeDir ?? homedir()
  };
}
function windowsRoamingBase(ctx) {
  return ctx.env.LOCALAPPDATA ?? ctx.env.APPDATA ?? join(ctx.homeDir, "AppData", "Local");
}
function resolveAppDataDir(input = {}) {
  const ctx = createPlatformContext(input);
  if (ctx.platform === "win32")
    return join(windowsRoamingBase(ctx), "Xiranite");
  if (ctx.platform === "darwin")
    return join(ctx.homeDir, "Library", "Application Support", "Xiranite");
  return join(ctx.env.XDG_DATA_HOME ?? join(ctx.homeDir, ".local", "share"), "xiranite");
}

// packages/config/dist/paths.js
var XIRANITE_CONFIG_FILENAME = "xiranite.config.toml";
function resolveXiraniteConfigPath(options = {}) {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  if (options.configPath)
    return resolve(cwd, options.configPath);
  if (env.XIRANITE_CONFIG_PATH)
    return resolve(cwd, env.XIRANITE_CONFIG_PATH);
  if (env.XIRANITE_DATABASE_PATH)
    return join(dirname(resolve(cwd, env.XIRANITE_DATABASE_PATH)), XIRANITE_CONFIG_FILENAME);
  if (env.XIRANITE_DATA_DIR)
    return join(resolve(cwd, env.XIRANITE_DATA_DIR), XIRANITE_CONFIG_FILENAME);
  if (options.databasePath)
    return join(dirname(resolve(cwd, options.databasePath)), XIRANITE_CONFIG_FILENAME);
  if (options.dataDir)
    return join(resolve(cwd, options.dataDir), XIRANITE_CONFIG_FILENAME);
  return join(defaultSystemDataDir(options), XIRANITE_CONFIG_FILENAME);
}
function defaultSystemDataDir(options) {
  return resolveAppDataDir(options);
}

// packages/config/node_modules/zod/v3/external.js
var external_exports = {};
__export(external_exports, {
  BRAND: () => BRAND,
  DIRTY: () => DIRTY,
  EMPTY_PATH: () => EMPTY_PATH,
  INVALID: () => INVALID,
  NEVER: () => NEVER,
  OK: () => OK,
  ParseStatus: () => ParseStatus,
  Schema: () => ZodType,
  ZodAny: () => ZodAny,
  ZodArray: () => ZodArray,
  ZodBigInt: () => ZodBigInt,
  ZodBoolean: () => ZodBoolean,
  ZodBranded: () => ZodBranded,
  ZodCatch: () => ZodCatch,
  ZodDate: () => ZodDate,
  ZodDefault: () => ZodDefault,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodEffects: () => ZodEffects,
  ZodEnum: () => ZodEnum,
  ZodError: () => ZodError,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodFunction: () => ZodFunction,
  ZodIntersection: () => ZodIntersection,
  ZodIssueCode: () => ZodIssueCode,
  ZodLazy: () => ZodLazy,
  ZodLiteral: () => ZodLiteral,
  ZodMap: () => ZodMap,
  ZodNaN: () => ZodNaN,
  ZodNativeEnum: () => ZodNativeEnum,
  ZodNever: () => ZodNever,
  ZodNull: () => ZodNull,
  ZodNullable: () => ZodNullable,
  ZodNumber: () => ZodNumber,
  ZodObject: () => ZodObject,
  ZodOptional: () => ZodOptional,
  ZodParsedType: () => ZodParsedType,
  ZodPipeline: () => ZodPipeline,
  ZodPromise: () => ZodPromise,
  ZodReadonly: () => ZodReadonly,
  ZodRecord: () => ZodRecord,
  ZodSchema: () => ZodType,
  ZodSet: () => ZodSet,
  ZodString: () => ZodString,
  ZodSymbol: () => ZodSymbol,
  ZodTransformer: () => ZodEffects,
  ZodTuple: () => ZodTuple,
  ZodType: () => ZodType,
  ZodUndefined: () => ZodUndefined,
  ZodUnion: () => ZodUnion,
  ZodUnknown: () => ZodUnknown,
  ZodVoid: () => ZodVoid,
  addIssueToContext: () => addIssueToContext,
  any: () => anyType,
  array: () => arrayType,
  bigint: () => bigIntType,
  boolean: () => booleanType,
  coerce: () => coerce,
  custom: () => custom,
  date: () => dateType,
  datetimeRegex: () => datetimeRegex,
  defaultErrorMap: () => en_default,
  discriminatedUnion: () => discriminatedUnionType,
  effect: () => effectsType,
  enum: () => enumType,
  function: () => functionType,
  getErrorMap: () => getErrorMap,
  getParsedType: () => getParsedType,
  instanceof: () => instanceOfType,
  intersection: () => intersectionType,
  isAborted: () => isAborted,
  isAsync: () => isAsync,
  isDirty: () => isDirty,
  isValid: () => isValid,
  late: () => late,
  lazy: () => lazyType,
  literal: () => literalType,
  makeIssue: () => makeIssue,
  map: () => mapType,
  nan: () => nanType,
  nativeEnum: () => nativeEnumType,
  never: () => neverType,
  null: () => nullType,
  nullable: () => nullableType,
  number: () => numberType,
  object: () => objectType,
  objectUtil: () => objectUtil,
  oboolean: () => oboolean,
  onumber: () => onumber,
  optional: () => optionalType,
  ostring: () => ostring,
  pipeline: () => pipelineType,
  preprocess: () => preprocessType,
  promise: () => promiseType,
  quotelessJson: () => quotelessJson,
  record: () => recordType,
  set: () => setType,
  setErrorMap: () => setErrorMap,
  strictObject: () => strictObjectType,
  string: () => stringType,
  symbol: () => symbolType,
  transformer: () => effectsType,
  tuple: () => tupleType,
  undefined: () => undefinedType,
  union: () => unionType,
  unknown: () => unknownType,
  util: () => util,
  void: () => voidType
});

// packages/config/node_modules/zod/v3/helpers/util.js
var util;
(function(util2) {
  util2.assertEqual = (_) => {
  };
  function assertIs(_arg) {
  }
  util2.assertIs = assertIs;
  function assertNever(_x) {
    throw new Error();
  }
  util2.assertNever = assertNever;
  util2.arrayToEnum = (items) => {
    const obj = {};
    for (const item of items) {
      obj[item] = item;
    }
    return obj;
  };
  util2.getValidEnumValues = (obj) => {
    const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
    const filtered = {};
    for (const k of validKeys) {
      filtered[k] = obj[k];
    }
    return util2.objectValues(filtered);
  };
  util2.objectValues = (obj) => {
    return util2.objectKeys(obj).map(function(e) {
      return obj[e];
    });
  };
  util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
    const keys = [];
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        keys.push(key);
      }
    }
    return keys;
  };
  util2.find = (arr, checker) => {
    for (const item of arr) {
      if (checker(item))
        return item;
    }
    return void 0;
  };
  util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
  function joinValues(array, separator = " | ") {
    return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  util2.joinValues = joinValues;
  util2.jsonStringifyReplacer = (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
})(util || (util = {}));
var objectUtil;
(function(objectUtil2) {
  objectUtil2.mergeShapes = (first, second) => {
    return {
      ...first,
      ...second
      // second overwrites first
    };
  };
})(objectUtil || (objectUtil = {}));
var ZodParsedType = util.arrayToEnum([
  "string",
  "nan",
  "number",
  "integer",
  "float",
  "boolean",
  "date",
  "bigint",
  "symbol",
  "function",
  "undefined",
  "null",
  "array",
  "object",
  "unknown",
  "promise",
  "void",
  "never",
  "map",
  "set"
]);
var getParsedType = (data2) => {
  const t = typeof data2;
  switch (t) {
    case "undefined":
      return ZodParsedType.undefined;
    case "string":
      return ZodParsedType.string;
    case "number":
      return Number.isNaN(data2) ? ZodParsedType.nan : ZodParsedType.number;
    case "boolean":
      return ZodParsedType.boolean;
    case "function":
      return ZodParsedType.function;
    case "bigint":
      return ZodParsedType.bigint;
    case "symbol":
      return ZodParsedType.symbol;
    case "object":
      if (Array.isArray(data2)) {
        return ZodParsedType.array;
      }
      if (data2 === null) {
        return ZodParsedType.null;
      }
      if (data2.then && typeof data2.then === "function" && data2.catch && typeof data2.catch === "function") {
        return ZodParsedType.promise;
      }
      if (typeof Map !== "undefined" && data2 instanceof Map) {
        return ZodParsedType.map;
      }
      if (typeof Set !== "undefined" && data2 instanceof Set) {
        return ZodParsedType.set;
      }
      if (typeof Date !== "undefined" && data2 instanceof Date) {
        return ZodParsedType.date;
      }
      return ZodParsedType.object;
    default:
      return ZodParsedType.unknown;
  }
};

// packages/config/node_modules/zod/v3/ZodError.js
var ZodIssueCode = util.arrayToEnum([
  "invalid_type",
  "invalid_literal",
  "custom",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_enum_value",
  "unrecognized_keys",
  "invalid_arguments",
  "invalid_return_type",
  "invalid_date",
  "invalid_string",
  "too_small",
  "too_big",
  "invalid_intersection_types",
  "not_multiple_of",
  "not_finite"
]);
var quotelessJson = (obj) => {
  const json = JSON.stringify(obj, null, 2);
  return json.replace(/"([^"]+)":/g, "$1:");
};
var ZodError = class _ZodError extends Error {
  get errors() {
    return this.issues;
  }
  constructor(issues) {
    super();
    this.issues = [];
    this.addIssue = (sub) => {
      this.issues = [...this.issues, sub];
    };
    this.addIssues = (subs = []) => {
      this.issues = [...this.issues, ...subs];
    };
    const actualProto = new.target.prototype;
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, actualProto);
    } else {
      this.__proto__ = actualProto;
    }
    this.name = "ZodError";
    this.issues = issues;
  }
  format(_mapper) {
    const mapper = _mapper || function(issue) {
      return issue.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = (error) => {
      for (const issue of error.issues) {
        if (issue.code === "invalid_union") {
          issue.unionErrors.map(processError);
        } else if (issue.code === "invalid_return_type") {
          processError(issue.returnTypeError);
        } else if (issue.code === "invalid_arguments") {
          processError(issue.argumentsError);
        } else if (issue.path.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue.path.length) {
            const el = issue.path[i];
            const terminal = i === issue.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    };
    processError(this);
    return fieldErrors;
  }
  static assert(value) {
    if (!(value instanceof _ZodError)) {
      throw new Error(`Not a ZodError: ${value}`);
    }
  }
  toString() {
    return this.message;
  }
  get message() {
    return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
  }
  get isEmpty() {
    return this.issues.length === 0;
  }
  flatten(mapper = (issue) => issue.message) {
    const fieldErrors = {};
    const formErrors = [];
    for (const sub of this.issues) {
      if (sub.path.length > 0) {
        const firstEl = sub.path[0];
        fieldErrors[firstEl] = fieldErrors[firstEl] || [];
        fieldErrors[firstEl].push(mapper(sub));
      } else {
        formErrors.push(mapper(sub));
      }
    }
    return { formErrors, fieldErrors };
  }
  get formErrors() {
    return this.flatten();
  }
};
ZodError.create = (issues) => {
  const error = new ZodError(issues);
  return error;
};

// packages/config/node_modules/zod/v3/locales/en.js
var errorMap = (issue, _ctx) => {
  let message;
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue.expected}, received ${issue.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue.options)}, received '${issue.received}'`;
      break;
    case ZodIssueCode.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode.invalid_string:
      if (typeof issue.validation === "object") {
        if ("includes" in issue.validation) {
          message = `Invalid input: must include "${issue.validation.includes}"`;
          if (typeof issue.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
          }
        } else if ("startsWith" in issue.validation) {
          message = `Invalid input: must start with "${issue.validation.startsWith}"`;
        } else if ("endsWith" in issue.validation) {
          message = `Invalid input: must end with "${issue.validation.endsWith}"`;
        } else {
          util.assertNever(issue.validation);
        }
      } else if (issue.validation !== "regex") {
        message = `Invalid ${issue.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "bigint")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "bigint")
        message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode.not_multiple_of:
      message = `Number must be a multiple of ${issue.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue);
  }
  return { message };
};
var en_default = errorMap;

// packages/config/node_modules/zod/v3/errors.js
var overrideErrorMap = en_default;
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}

// packages/config/node_modules/zod/v3/helpers/parseUtil.js
var makeIssue = (params) => {
  const { data: data2, path, errorMaps, issueData } = params;
  const fullPath = [...path, ...issueData.path || []];
  const fullIssue = {
    ...issueData,
    path: fullPath
  };
  if (issueData.message !== void 0) {
    return {
      ...issueData,
      path: fullPath,
      message: issueData.message
    };
  }
  let errorMessage = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map of maps) {
    errorMessage = map(fullIssue, { data: data2, defaultError: errorMessage }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage
  };
};
var EMPTY_PATH = [];
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      // contextual error map is first priority
      ctx.schemaErrorMap,
      // then schema-bound map if available
      overrideMap,
      // then global override map
      overrideMap === en_default ? void 0 : en_default
      // then global default map
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue);
}
var ParseStatus = class _ParseStatus {
  constructor() {
    this.value = "valid";
  }
  dirty() {
    if (this.value === "valid")
      this.value = "dirty";
  }
  abort() {
    if (this.value !== "aborted")
      this.value = "aborted";
  }
  static mergeArray(status, results) {
    const arrayValue = [];
    for (const s of results) {
      if (s.status === "aborted")
        return INVALID;
      if (s.status === "dirty")
        status.dirty();
      arrayValue.push(s.value);
    }
    return { status: status.value, value: arrayValue };
  }
  static async mergeObjectAsync(status, pairs) {
    const syncPairs = [];
    for (const pair of pairs) {
      const key = await pair.key;
      const value = await pair.value;
      syncPairs.push({
        key,
        value
      });
    }
    return _ParseStatus.mergeObjectSync(status, syncPairs);
  }
  static mergeObjectSync(status, pairs) {
    const finalObject = {};
    for (const pair of pairs) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID;
      if (value.status === "aborted")
        return INVALID;
      if (key.status === "dirty")
        status.dirty();
      if (value.status === "dirty")
        status.dirty();
      if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
        finalObject[key.value] = value.value;
      }
    }
    return { status: status.value, value: finalObject };
  }
};
var INVALID = Object.freeze({
  status: "aborted"
});
var DIRTY = (value) => ({ status: "dirty", value });
var OK = (value) => ({ status: "valid", value });
var isAborted = (x) => x.status === "aborted";
var isDirty = (x) => x.status === "dirty";
var isValid = (x) => x.status === "valid";
var isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;

// packages/config/node_modules/zod/v3/helpers/errorUtil.js
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil || (errorUtil = {}));

// packages/config/node_modules/zod/v3/types.js
var ParseInputLazyPath = class {
  constructor(parent, value, path, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path;
    this._key = key;
  }
  get path() {
    if (!this._cachedPath.length) {
      if (Array.isArray(this._key)) {
        this._cachedPath.push(...this._path, ...this._key);
      } else {
        this._cachedPath.push(...this._path, this._key);
      }
    }
    return this._cachedPath;
  }
};
var handleResult = (ctx, result) => {
  if (isValid(result)) {
    return { success: true, data: result.value };
  } else {
    if (!ctx.common.issues.length) {
      throw new Error("Validation failed but no issues detected.");
    }
    return {
      success: false,
      get error() {
        if (this._error)
          return this._error;
        const error = new ZodError(ctx.common.issues);
        this._error = error;
        return this._error;
      }
    };
  }
};
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = (iss, ctx) => {
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message ?? ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: message ?? required_error ?? ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: message ?? invalid_type_error ?? ctx.defaultError };
  };
  return { errorMap: customMap, description };
}
var ZodType = class {
  get description() {
    return this._def.description;
  }
  _getType(input) {
    return getParsedType(input.data);
  }
  _getOrReturnCtx(input, ctx) {
    return ctx || {
      common: input.parent.common,
      data: input.data,
      parsedType: getParsedType(input.data),
      schemaErrorMap: this._def.errorMap,
      path: input.path,
      parent: input.parent
    };
  }
  _processInputParams(input) {
    return {
      status: new ParseStatus(),
      ctx: {
        common: input.parent.common,
        data: input.data,
        parsedType: getParsedType(input.data),
        schemaErrorMap: this._def.errorMap,
        path: input.path,
        parent: input.parent
      }
    };
  }
  _parseSync(input) {
    const result = this._parse(input);
    if (isAsync(result)) {
      throw new Error("Synchronous parse encountered promise.");
    }
    return result;
  }
  _parseAsync(input) {
    const result = this._parse(input);
    return Promise.resolve(result);
  }
  parse(data2, params) {
    const result = this.safeParse(data2, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  safeParse(data2, params) {
    const ctx = {
      common: {
        issues: [],
        async: params?.async ?? false,
        contextualErrorMap: params?.errorMap
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data: data2,
      parsedType: getParsedType(data2)
    };
    const result = this._parseSync({ data: data2, path: ctx.path, parent: ctx });
    return handleResult(ctx, result);
  }
  "~validate"(data2) {
    const ctx = {
      common: {
        issues: [],
        async: !!this["~standard"].async
      },
      path: [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data: data2,
      parsedType: getParsedType(data2)
    };
    if (!this["~standard"].async) {
      try {
        const result = this._parseSync({ data: data2, path: [], parent: ctx });
        return isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        };
      } catch (err) {
        if (err?.message?.toLowerCase()?.includes("encountered")) {
          this["~standard"].async = true;
        }
        ctx.common = {
          issues: [],
          async: true
        };
      }
    }
    return this._parseAsync({ data: data2, path: [], parent: ctx }).then((result) => isValid(result) ? {
      value: result.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data2, params) {
    const result = await this.safeParseAsync(data2, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  async safeParseAsync(data2, params) {
    const ctx = {
      common: {
        issues: [],
        contextualErrorMap: params?.errorMap,
        async: true
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data: data2,
      parsedType: getParsedType(data2)
    };
    const maybeAsyncResult = this._parse({ data: data2, path: ctx.path, parent: ctx });
    const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result);
  }
  refine(check, message) {
    const getIssueProperties = (val) => {
      if (typeof message === "string" || typeof message === "undefined") {
        return { message };
      } else if (typeof message === "function") {
        return message(val);
      } else {
        return message;
      }
    };
    return this._refinement((val, ctx) => {
      const result = check(val);
      const setError = () => ctx.addIssue({
        code: ZodIssueCode.custom,
        ...getIssueProperties(val)
      });
      if (typeof Promise !== "undefined" && result instanceof Promise) {
        return result.then((data2) => {
          if (!data2) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      if (!result) {
        setError();
        return false;
      } else {
        return true;
      }
    });
  }
  refinement(check, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects({
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "refinement", refinement }
    });
  }
  superRefine(refinement) {
    return this._refinement(refinement);
  }
  constructor(def) {
    this.spa = this.safeParseAsync;
    this._def = def;
    this.parse = this.parse.bind(this);
    this.safeParse = this.safeParse.bind(this);
    this.parseAsync = this.parseAsync.bind(this);
    this.safeParseAsync = this.safeParseAsync.bind(this);
    this.spa = this.spa.bind(this);
    this.refine = this.refine.bind(this);
    this.refinement = this.refinement.bind(this);
    this.superRefine = this.superRefine.bind(this);
    this.optional = this.optional.bind(this);
    this.nullable = this.nullable.bind(this);
    this.nullish = this.nullish.bind(this);
    this.array = this.array.bind(this);
    this.promise = this.promise.bind(this);
    this.or = this.or.bind(this);
    this.and = this.and.bind(this);
    this.transform = this.transform.bind(this);
    this.brand = this.brand.bind(this);
    this.default = this.default.bind(this);
    this.catch = this.catch.bind(this);
    this.describe = this.describe.bind(this);
    this.pipe = this.pipe.bind(this);
    this.readonly = this.readonly.bind(this);
    this.isNullable = this.isNullable.bind(this);
    this.isOptional = this.isOptional.bind(this);
    this["~standard"] = {
      version: 1,
      vendor: "zod",
      validate: (data2) => this["~validate"](data2)
    };
  }
  optional() {
    return ZodOptional.create(this, this._def);
  }
  nullable() {
    return ZodNullable.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray.create(this);
  }
  promise() {
    return ZodPromise.create(this, this._def);
  }
  or(option) {
    return ZodUnion.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection.create(this, incoming, this._def);
  }
  transform(transform) {
    return new ZodEffects({
      ...processCreateParams(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault({
      ...processCreateParams(this._def),
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodDefault
    });
  }
  brand() {
    return new ZodBranded({
      typeName: ZodFirstPartyTypeKind.ZodBranded,
      type: this,
      ...processCreateParams(this._def)
    });
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch({
      ...processCreateParams(this._def),
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodCatch
    });
  }
  describe(description) {
    const This = this.constructor;
    return new This({
      ...this._def,
      description
    });
  }
  pipe(target) {
    return ZodPipeline.create(this, target);
  }
  readonly() {
    return ZodReadonly.create(this);
  }
  isOptional() {
    return this.safeParse(void 0).success;
  }
  isNullable() {
    return this.safeParse(null).success;
  }
};
var cuidRegex = /^c[^\s-]{8,}$/i;
var cuid2Regex = /^[0-9a-z]+$/;
var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex = /^[a-z0-9_-]{21}$/i;
var jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex;
var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
var ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
var ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if ("typ" in decoded && decoded?.typ !== "JWT")
      return false;
    if (!decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch {
    return false;
  }
}
function isValidCidr(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}
var ZodString = class _ZodString extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = String(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.string) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.string,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.length < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.length > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "length") {
        const tooBig = input.data.length > check.value;
        const tooSmall = input.data.length < check.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          if (tooBig) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          } else if (tooSmall) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          }
          status.dirty();
        }
      } else if (check.kind === "email") {
        if (!emailRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "email",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "emoji") {
        if (!emojiRegex) {
          emojiRegex = new RegExp(_emojiRegex, "u");
        }
        if (!emojiRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "emoji",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "uuid") {
        if (!uuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "uuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "nanoid") {
        if (!nanoidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "nanoid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid") {
        if (!cuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid2") {
        if (!cuid2Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid2",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ulid") {
        if (!ulidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ulid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "url") {
        try {
          new URL(input.data);
        } catch {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "regex") {
        check.regex.lastIndex = 0;
        const testResult = check.regex.test(input.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "regex",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "trim") {
        input.data = input.data.trim();
      } else if (check.kind === "includes") {
        if (!input.data.includes(check.value, check.position)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { includes: check.value, position: check.position },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "toLowerCase") {
        input.data = input.data.toLowerCase();
      } else if (check.kind === "toUpperCase") {
        input.data = input.data.toUpperCase();
      } else if (check.kind === "startsWith") {
        if (!input.data.startsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { startsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "endsWith") {
        if (!input.data.endsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { endsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "datetime") {
        const regex = datetimeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "datetime",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "date") {
        const regex = dateRegex;
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "date",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "time") {
        const regex = timeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "time",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "duration") {
        if (!durationRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "duration",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ip") {
        if (!isValidIP(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ip",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "jwt") {
        if (!isValidJWT(input.data, check.alg)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "jwt",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cidr") {
        if (!isValidCidr(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cidr",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64") {
        if (!base64Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64url") {
        if (!base64urlRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _regex(regex, validation, message) {
    return this.refinement((data2) => regex.test(data2), {
      validation,
      code: ZodIssueCode.invalid_string,
      ...errorUtil.errToObj(message)
    });
  }
  _addCheck(check) {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  email(message) {
    return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
  }
  url(message) {
    return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
  }
  emoji(message) {
    return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
  }
  uuid(message) {
    return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
  }
  nanoid(message) {
    return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
  }
  cuid(message) {
    return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
  }
  cuid2(message) {
    return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
  }
  ulid(message) {
    return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
  }
  base64(message) {
    return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
  }
  base64url(message) {
    return this._addCheck({
      kind: "base64url",
      ...errorUtil.errToObj(message)
    });
  }
  jwt(options) {
    return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
  }
  ip(options) {
    return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
  }
  cidr(options) {
    return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
  }
  datetime(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "datetime",
        precision: null,
        offset: false,
        local: false,
        message: options
      });
    }
    return this._addCheck({
      kind: "datetime",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      offset: options?.offset ?? false,
      local: options?.local ?? false,
      ...errorUtil.errToObj(options?.message)
    });
  }
  date(message) {
    return this._addCheck({ kind: "date", message });
  }
  time(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "time",
        precision: null,
        message: options
      });
    }
    return this._addCheck({
      kind: "time",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      ...errorUtil.errToObj(options?.message)
    });
  }
  duration(message) {
    return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
  }
  regex(regex, message) {
    return this._addCheck({
      kind: "regex",
      regex,
      ...errorUtil.errToObj(message)
    });
  }
  includes(value, options) {
    return this._addCheck({
      kind: "includes",
      value,
      position: options?.position,
      ...errorUtil.errToObj(options?.message)
    });
  }
  startsWith(value, message) {
    return this._addCheck({
      kind: "startsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  endsWith(value, message) {
    return this._addCheck({
      kind: "endsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  min(minLength, message) {
    return this._addCheck({
      kind: "min",
      value: minLength,
      ...errorUtil.errToObj(message)
    });
  }
  max(maxLength, message) {
    return this._addCheck({
      kind: "max",
      value: maxLength,
      ...errorUtil.errToObj(message)
    });
  }
  length(len, message) {
    return this._addCheck({
      kind: "length",
      value: len,
      ...errorUtil.errToObj(message)
    });
  }
  /**
   * Equivalent to `.min(1)`
   */
  nonempty(message) {
    return this.min(1, errorUtil.errToObj(message));
  }
  trim() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "trim" }]
    });
  }
  toLowerCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    });
  }
  toUpperCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toUpperCase" }]
    });
  }
  get isDatetime() {
    return !!this._def.checks.find((ch) => ch.kind === "datetime");
  }
  get isDate() {
    return !!this._def.checks.find((ch) => ch.kind === "date");
  }
  get isTime() {
    return !!this._def.checks.find((ch) => ch.kind === "time");
  }
  get isDuration() {
    return !!this._def.checks.find((ch) => ch.kind === "duration");
  }
  get isEmail() {
    return !!this._def.checks.find((ch) => ch.kind === "email");
  }
  get isURL() {
    return !!this._def.checks.find((ch) => ch.kind === "url");
  }
  get isEmoji() {
    return !!this._def.checks.find((ch) => ch.kind === "emoji");
  }
  get isUUID() {
    return !!this._def.checks.find((ch) => ch.kind === "uuid");
  }
  get isNANOID() {
    return !!this._def.checks.find((ch) => ch.kind === "nanoid");
  }
  get isCUID() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid");
  }
  get isCUID2() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid2");
  }
  get isULID() {
    return !!this._def.checks.find((ch) => ch.kind === "ulid");
  }
  get isIP() {
    return !!this._def.checks.find((ch) => ch.kind === "ip");
  }
  get isCIDR() {
    return !!this._def.checks.find((ch) => ch.kind === "cidr");
  }
  get isBase64() {
    return !!this._def.checks.find((ch) => ch.kind === "base64");
  }
  get isBase64url() {
    return !!this._def.checks.find((ch) => ch.kind === "base64url");
  }
  get minLength() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxLength() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodString.create = (params) => {
  return new ZodString({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodString,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}
var ZodNumber = class _ZodNumber extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
    this.step = this.multipleOf;
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = Number(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.number) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.number,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "int") {
        if (!util.isInteger(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: "integer",
            received: "float",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (floatSafeRemainder(input.data, check.value) !== 0) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "finite") {
        if (!Number.isFinite(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_finite,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodNumber({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodNumber({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  int(message) {
    return this._addCheck({
      kind: "int",
      message: errorUtil.toString(message)
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  finite(message) {
    return this._addCheck({
      kind: "finite",
      message: errorUtil.toString(message)
    });
  }
  safe(message) {
    return this._addCheck({
      kind: "min",
      inclusive: true,
      value: Number.MIN_SAFE_INTEGER,
      message: errorUtil.toString(message)
    })._addCheck({
      kind: "max",
      inclusive: true,
      value: Number.MAX_SAFE_INTEGER,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
  get isInt() {
    return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
  }
  get isFinite() {
    let max = null;
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
        return true;
      } else if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      } else if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return Number.isFinite(min) && Number.isFinite(max);
  }
};
ZodNumber.create = (params) => {
  return new ZodNumber({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodNumber,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodBigInt = class _ZodBigInt extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
  }
  _parse(input) {
    if (this._def.coerce) {
      try {
        input.data = BigInt(input.data);
      } catch {
        return this._getInvalidInput(input);
      }
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.bigint) {
      return this._getInvalidInput(input);
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            type: "bigint",
            minimum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            type: "bigint",
            maximum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (input.data % check.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _getInvalidInput(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.bigint,
      received: ctx.parsedType
    });
    return INVALID;
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodBigInt({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodBigInt({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodBigInt.create = (params) => {
  return new ZodBigInt({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodBigInt,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
var ZodBoolean = class extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = Boolean(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.boolean) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.boolean,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodBoolean.create = (params) => {
  return new ZodBoolean({
    typeName: ZodFirstPartyTypeKind.ZodBoolean,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodDate = class _ZodDate extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = new Date(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.date) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.date,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    if (Number.isNaN(input.data.getTime())) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_date
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.getTime() < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            message: check.message,
            inclusive: true,
            exact: false,
            minimum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.getTime() > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            message: check.message,
            inclusive: true,
            exact: false,
            maximum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return {
      status: status.value,
      value: new Date(input.data.getTime())
    };
  }
  _addCheck(check) {
    return new _ZodDate({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  min(minDate, message) {
    return this._addCheck({
      kind: "min",
      value: minDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  max(maxDate, message) {
    return this._addCheck({
      kind: "max",
      value: maxDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  get minDate() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min != null ? new Date(min) : null;
  }
  get maxDate() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max != null ? new Date(max) : null;
  }
};
ZodDate.create = (params) => {
  return new ZodDate({
    checks: [],
    coerce: params?.coerce || false,
    typeName: ZodFirstPartyTypeKind.ZodDate,
    ...processCreateParams(params)
  });
};
var ZodSymbol = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.symbol) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.symbol,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodSymbol.create = (params) => {
  return new ZodSymbol({
    typeName: ZodFirstPartyTypeKind.ZodSymbol,
    ...processCreateParams(params)
  });
};
var ZodUndefined = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.undefined,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodUndefined.create = (params) => {
  return new ZodUndefined({
    typeName: ZodFirstPartyTypeKind.ZodUndefined,
    ...processCreateParams(params)
  });
};
var ZodNull = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.null) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.null,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodNull.create = (params) => {
  return new ZodNull({
    typeName: ZodFirstPartyTypeKind.ZodNull,
    ...processCreateParams(params)
  });
};
var ZodAny = class extends ZodType {
  constructor() {
    super(...arguments);
    this._any = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodAny.create = (params) => {
  return new ZodAny({
    typeName: ZodFirstPartyTypeKind.ZodAny,
    ...processCreateParams(params)
  });
};
var ZodUnknown = class extends ZodType {
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodUnknown.create = (params) => {
  return new ZodUnknown({
    typeName: ZodFirstPartyTypeKind.ZodUnknown,
    ...processCreateParams(params)
  });
};
var ZodNever = class extends ZodType {
  _parse(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.never,
      received: ctx.parsedType
    });
    return INVALID;
  }
};
ZodNever.create = (params) => {
  return new ZodNever({
    typeName: ZodFirstPartyTypeKind.ZodNever,
    ...processCreateParams(params)
  });
};
var ZodVoid = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.void,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodVoid.create = (params) => {
  return new ZodVoid({
    typeName: ZodFirstPartyTypeKind.ZodVoid,
    ...processCreateParams(params)
  });
};
var ZodArray = class _ZodArray extends ZodType {
  _parse(input) {
    const { ctx, status } = this._processInputParams(input);
    const def = this._def;
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (def.exactLength !== null) {
      const tooBig = ctx.data.length > def.exactLength.value;
      const tooSmall = ctx.data.length < def.exactLength.value;
      if (tooBig || tooSmall) {
        addIssueToContext(ctx, {
          code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
          minimum: tooSmall ? def.exactLength.value : void 0,
          maximum: tooBig ? def.exactLength.value : void 0,
          type: "array",
          inclusive: true,
          exact: true,
          message: def.exactLength.message
        });
        status.dirty();
      }
    }
    if (def.minLength !== null) {
      if (ctx.data.length < def.minLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.minLength.message
        });
        status.dirty();
      }
    }
    if (def.maxLength !== null) {
      if (ctx.data.length > def.maxLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.maxLength.message
        });
        status.dirty();
      }
    }
    if (ctx.common.async) {
      return Promise.all([...ctx.data].map((item, i) => {
        return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
      })).then((result2) => {
        return ParseStatus.mergeArray(status, result2);
      });
    }
    const result = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
    });
    return ParseStatus.mergeArray(status, result);
  }
  get element() {
    return this._def.type;
  }
  min(minLength, message) {
    return new _ZodArray({
      ...this._def,
      minLength: { value: minLength, message: errorUtil.toString(message) }
    });
  }
  max(maxLength, message) {
    return new _ZodArray({
      ...this._def,
      maxLength: { value: maxLength, message: errorUtil.toString(message) }
    });
  }
  length(len, message) {
    return new _ZodArray({
      ...this._def,
      exactLength: { value: len, message: errorUtil.toString(message) }
    });
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodArray.create = (schema, params) => {
  return new ZodArray({
    type: schema,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind.ZodArray,
    ...processCreateParams(params)
  });
};
function deepPartialify(schema) {
  if (schema instanceof ZodObject) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray) {
    return new ZodArray({
      ...schema._def,
      type: deepPartialify(schema.element)
    });
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}
var ZodObject = class _ZodObject extends ZodType {
  constructor() {
    super(...arguments);
    this._cached = null;
    this.nonstrict = this.passthrough;
    this.augment = this.extend;
  }
  _getCached() {
    if (this._cached !== null)
      return this._cached;
    const shape = this._def.shape();
    const keys = util.objectKeys(shape);
    this._cached = { shape, keys };
    return this._cached;
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.object) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const { status, ctx } = this._processInputParams(input);
    const { shape, keys: shapeKeys } = this._getCached();
    const extraKeys = [];
    if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
      for (const key in ctx.data) {
        if (!shapeKeys.includes(key)) {
          extraKeys.push(key);
        }
      }
    }
    const pairs = [];
    for (const key of shapeKeys) {
      const keyValidator = shape[key];
      const value = ctx.data[key];
      pairs.push({
        key: { status: "valid", value: key },
        value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (this._def.catchall instanceof ZodNever) {
      const unknownKeys = this._def.unknownKeys;
      if (unknownKeys === "passthrough") {
        for (const key of extraKeys) {
          pairs.push({
            key: { status: "valid", value: key },
            value: { status: "valid", value: ctx.data[key] }
          });
        }
      } else if (unknownKeys === "strict") {
        if (extraKeys.length > 0) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.unrecognized_keys,
            keys: extraKeys
          });
          status.dirty();
        }
      } else if (unknownKeys === "strip") {
      } else {
        throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
      }
    } else {
      const catchall = this._def.catchall;
      for (const key of extraKeys) {
        const value = ctx.data[key];
        pairs.push({
          key: { status: "valid", value: key },
          value: catchall._parse(
            new ParseInputLazyPath(ctx, value, ctx.path, key)
            //, ctx.child(key), value, getParsedType(value)
          ),
          alwaysSet: key in ctx.data
        });
      }
    }
    if (ctx.common.async) {
      return Promise.resolve().then(async () => {
        const syncPairs = [];
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value,
            alwaysSet: pair.alwaysSet
          });
        }
        return syncPairs;
      }).then((syncPairs) => {
        return ParseStatus.mergeObjectSync(status, syncPairs);
      });
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get shape() {
    return this._def.shape();
  }
  strict(message) {
    errorUtil.errToObj;
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strict",
      ...message !== void 0 ? {
        errorMap: (issue, ctx) => {
          const defaultError = this._def.errorMap?.(issue, ctx).message ?? ctx.defaultError;
          if (issue.code === "unrecognized_keys")
            return {
              message: errorUtil.errToObj(message).message ?? defaultError
            };
          return {
            message: defaultError
          };
        }
      } : {}
    });
  }
  strip() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strip"
    });
  }
  passthrough() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "passthrough"
    });
  }
  // const AugmentFactory =
  //   <Def extends ZodObjectDef>(def: Def) =>
  //   <Augmentation extends ZodRawShape>(
  //     augmentation: Augmentation
  //   ): ZodObject<
  //     extendShape<ReturnType<Def["shape"]>, Augmentation>,
  //     Def["unknownKeys"],
  //     Def["catchall"]
  //   > => {
  //     return new ZodObject({
  //       ...def,
  //       shape: () => ({
  //         ...def.shape(),
  //         ...augmentation,
  //       }),
  //     }) as any;
  //   };
  extend(augmentation) {
    return new _ZodObject({
      ...this._def,
      shape: () => ({
        ...this._def.shape(),
        ...augmentation
      })
    });
  }
  /**
   * Prior to zod@1.0.12 there was a bug in the
   * inferred type of merged objects. Please
   * upgrade if you are experiencing issues.
   */
  merge(merging) {
    const merged = new _ZodObject({
      unknownKeys: merging._def.unknownKeys,
      catchall: merging._def.catchall,
      shape: () => ({
        ...this._def.shape(),
        ...merging._def.shape()
      }),
      typeName: ZodFirstPartyTypeKind.ZodObject
    });
    return merged;
  }
  // merge<
  //   Incoming extends AnyZodObject,
  //   Augmentation extends Incoming["shape"],
  //   NewOutput extends {
  //     [k in keyof Augmentation | keyof Output]: k extends keyof Augmentation
  //       ? Augmentation[k]["_output"]
  //       : k extends keyof Output
  //       ? Output[k]
  //       : never;
  //   },
  //   NewInput extends {
  //     [k in keyof Augmentation | keyof Input]: k extends keyof Augmentation
  //       ? Augmentation[k]["_input"]
  //       : k extends keyof Input
  //       ? Input[k]
  //       : never;
  //   }
  // >(
  //   merging: Incoming
  // ): ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"],
  //   NewOutput,
  //   NewInput
  // > {
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  setKey(key, schema) {
    return this.augment({ [key]: schema });
  }
  // merge<Incoming extends AnyZodObject>(
  //   merging: Incoming
  // ): //ZodObject<T & Incoming["_shape"], UnknownKeys, Catchall> = (merging) => {
  // ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"]
  // > {
  //   // const mergedShape = objectUtil.mergeShapes(
  //   //   this._def.shape(),
  //   //   merging._def.shape()
  //   // );
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  catchall(index) {
    return new _ZodObject({
      ...this._def,
      catchall: index
    });
  }
  pick(mask) {
    const shape = {};
    for (const key of util.objectKeys(mask)) {
      if (mask[key] && this.shape[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  omit(mask) {
    const shape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (!mask[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  /**
   * @deprecated
   */
  deepPartial() {
    return deepPartialify(this);
  }
  partial(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      const fieldSchema = this.shape[key];
      if (mask && !mask[key]) {
        newShape[key] = fieldSchema;
      } else {
        newShape[key] = fieldSchema.optional();
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  required(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (mask && !mask[key]) {
        newShape[key] = this.shape[key];
      } else {
        const fieldSchema = this.shape[key];
        let newField = fieldSchema;
        while (newField instanceof ZodOptional) {
          newField = newField._def.innerType;
        }
        newShape[key] = newField;
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  keyof() {
    return createZodEnum(util.objectKeys(this.shape));
  }
};
ZodObject.create = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.strictCreate = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strict",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.lazycreate = (shape, params) => {
  return new ZodObject({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
var ZodUnion = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const options = this._def.options;
    function handleResults(results) {
      for (const result of results) {
        if (result.result.status === "valid") {
          return result.result;
        }
      }
      for (const result of results) {
        if (result.result.status === "dirty") {
          ctx.common.issues.push(...result.ctx.common.issues);
          return result.result;
        }
      }
      const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return Promise.all(options.map(async (option) => {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        return {
          result: await option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: childCtx
          }),
          ctx: childCtx
        };
      })).then(handleResults);
    } else {
      let dirty = void 0;
      const issues = [];
      for (const option of options) {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        const result = option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: childCtx
        });
        if (result.status === "valid") {
          return result;
        } else if (result.status === "dirty" && !dirty) {
          dirty = { result, ctx: childCtx };
        }
        if (childCtx.common.issues.length) {
          issues.push(childCtx.common.issues);
        }
      }
      if (dirty) {
        ctx.common.issues.push(...dirty.ctx.common.issues);
        return dirty.result;
      }
      const unionErrors = issues.map((issues2) => new ZodError(issues2));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
  }
  get options() {
    return this._def.options;
  }
};
ZodUnion.create = (types, params) => {
  return new ZodUnion({
    options: types,
    typeName: ZodFirstPartyTypeKind.ZodUnion,
    ...processCreateParams(params)
  });
};
var getDiscriminator = (type) => {
  if (type instanceof ZodLazy) {
    return getDiscriminator(type.schema);
  } else if (type instanceof ZodEffects) {
    return getDiscriminator(type.innerType());
  } else if (type instanceof ZodLiteral) {
    return [type.value];
  } else if (type instanceof ZodEnum) {
    return type.options;
  } else if (type instanceof ZodNativeEnum) {
    return util.objectValues(type.enum);
  } else if (type instanceof ZodDefault) {
    return getDiscriminator(type._def.innerType);
  } else if (type instanceof ZodUndefined) {
    return [void 0];
  } else if (type instanceof ZodNull) {
    return [null];
  } else if (type instanceof ZodOptional) {
    return [void 0, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodNullable) {
    return [null, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodBranded) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodReadonly) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodCatch) {
    return getDiscriminator(type._def.innerType);
  } else {
    return [];
  }
};
var ZodDiscriminatedUnion = class _ZodDiscriminatedUnion extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const discriminator = this.discriminator;
    const discriminatorValue = ctx.data[discriminator];
    const option = this.optionsMap.get(discriminatorValue);
    if (!option) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union_discriminator,
        options: Array.from(this.optionsMap.keys()),
        path: [discriminator]
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return option._parseAsync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    } else {
      return option._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    }
  }
  get discriminator() {
    return this._def.discriminator;
  }
  get options() {
    return this._def.options;
  }
  get optionsMap() {
    return this._def.optionsMap;
  }
  /**
   * The constructor of the discriminated union schema. Its behaviour is very similar to that of the normal z.union() constructor.
   * However, it only allows a union of objects, all of which need to share a discriminator property. This property must
   * have a different value for each object in the union.
   * @param discriminator the name of the discriminator property
   * @param types an array of object schemas
   * @param params
   */
  static create(discriminator, options, params) {
    const optionsMap = /* @__PURE__ */ new Map();
    for (const type of options) {
      const discriminatorValues = getDiscriminator(type.shape[discriminator]);
      if (!discriminatorValues.length) {
        throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
      }
      for (const value of discriminatorValues) {
        if (optionsMap.has(value)) {
          throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
        }
        optionsMap.set(value, type);
      }
    }
    return new _ZodDiscriminatedUnion({
      typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
      discriminator,
      options,
      optionsMap,
      ...processCreateParams(params)
    });
  }
};
function mergeValues(a, b) {
  const aType = getParsedType(a);
  const bType = getParsedType(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}
var ZodIntersection = class extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const handleParsed = (parsedLeft, parsedRight) => {
      if (isAborted(parsedLeft) || isAborted(parsedRight)) {
        return INVALID;
      }
      const merged = mergeValues(parsedLeft.value, parsedRight.value);
      if (!merged.valid) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_intersection_types
        });
        return INVALID;
      }
      if (isDirty(parsedLeft) || isDirty(parsedRight)) {
        status.dirty();
      }
      return { status: status.value, value: merged.data };
    };
    if (ctx.common.async) {
      return Promise.all([
        this._def.left._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }),
        this._def.right._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        })
      ]).then(([left, right]) => handleParsed(left, right));
    } else {
      return handleParsed(this._def.left._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }), this._def.right._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }));
    }
  }
};
ZodIntersection.create = (left, right, params) => {
  return new ZodIntersection({
    left,
    right,
    typeName: ZodFirstPartyTypeKind.ZodIntersection,
    ...processCreateParams(params)
  });
};
var ZodTuple = class _ZodTuple extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (ctx.data.length < this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_small,
        minimum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      return INVALID;
    }
    const rest = this._def.rest;
    if (!rest && ctx.data.length > this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_big,
        maximum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      status.dirty();
    }
    const items = [...ctx.data].map((item, itemIndex) => {
      const schema = this._def.items[itemIndex] || this._def.rest;
      if (!schema)
        return null;
      return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
    }).filter((x) => !!x);
    if (ctx.common.async) {
      return Promise.all(items).then((results) => {
        return ParseStatus.mergeArray(status, results);
      });
    } else {
      return ParseStatus.mergeArray(status, items);
    }
  }
  get items() {
    return this._def.items;
  }
  rest(rest) {
    return new _ZodTuple({
      ...this._def,
      rest
    });
  }
};
ZodTuple.create = (schemas, params) => {
  if (!Array.isArray(schemas)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple({
    items: schemas,
    typeName: ZodFirstPartyTypeKind.ZodTuple,
    rest: null,
    ...processCreateParams(params)
  });
};
var ZodRecord = class _ZodRecord extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const pairs = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs.push({
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus.mergeObjectAsync(status, pairs);
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get element() {
    return this._def.valueType;
  }
  static create(first, second, third) {
    if (second instanceof ZodType) {
      return new _ZodRecord({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(third)
      });
    }
    return new _ZodRecord({
      keyType: ZodString.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind.ZodRecord,
      ...processCreateParams(second)
    });
  }
};
var ZodMap = class extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.map) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.map,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    const pairs = [...ctx.data.entries()].map(([key, value], index) => {
      return {
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
        value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = /* @__PURE__ */ new Map();
      return Promise.resolve().then(async () => {
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID;
          }
          if (key.status === "dirty" || value.status === "dirty") {
            status.dirty();
          }
          finalMap.set(key.value, value.value);
        }
        return { status: status.value, value: finalMap };
      });
    } else {
      const finalMap = /* @__PURE__ */ new Map();
      for (const pair of pairs) {
        const key = pair.key;
        const value = pair.value;
        if (key.status === "aborted" || value.status === "aborted") {
          return INVALID;
        }
        if (key.status === "dirty" || value.status === "dirty") {
          status.dirty();
        }
        finalMap.set(key.value, value.value);
      }
      return { status: status.value, value: finalMap };
    }
  }
};
ZodMap.create = (keyType, valueType, params) => {
  return new ZodMap({
    valueType,
    keyType,
    typeName: ZodFirstPartyTypeKind.ZodMap,
    ...processCreateParams(params)
  });
};
var ZodSet = class _ZodSet extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.set) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.set,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const def = this._def;
    if (def.minSize !== null) {
      if (ctx.data.size < def.minSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.minSize.message
        });
        status.dirty();
      }
    }
    if (def.maxSize !== null) {
      if (ctx.data.size > def.maxSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.maxSize.message
        });
        status.dirty();
      }
    }
    const valueType = this._def.valueType;
    function finalizeSet(elements2) {
      const parsedSet = /* @__PURE__ */ new Set();
      for (const element of elements2) {
        if (element.status === "aborted")
          return INVALID;
        if (element.status === "dirty")
          status.dirty();
        parsedSet.add(element.value);
      }
      return { status: status.value, value: parsedSet };
    }
    const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
    if (ctx.common.async) {
      return Promise.all(elements).then((elements2) => finalizeSet(elements2));
    } else {
      return finalizeSet(elements);
    }
  }
  min(minSize, message) {
    return new _ZodSet({
      ...this._def,
      minSize: { value: minSize, message: errorUtil.toString(message) }
    });
  }
  max(maxSize, message) {
    return new _ZodSet({
      ...this._def,
      maxSize: { value: maxSize, message: errorUtil.toString(message) }
    });
  }
  size(size, message) {
    return this.min(size, message).max(size, message);
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodSet.create = (valueType, params) => {
  return new ZodSet({
    valueType,
    minSize: null,
    maxSize: null,
    typeName: ZodFirstPartyTypeKind.ZodSet,
    ...processCreateParams(params)
  });
};
var ZodFunction = class _ZodFunction extends ZodType {
  constructor() {
    super(...arguments);
    this.validate = this.implement;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.function) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.function,
        received: ctx.parsedType
      });
      return INVALID;
    }
    function makeArgsIssue(args, error) {
      return makeIssue({
        data: args,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_arguments,
          argumentsError: error
        }
      });
    }
    function makeReturnsIssue(returns, error) {
      return makeIssue({
        data: returns,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_return_type,
          returnTypeError: error
        }
      });
    }
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise) {
      const me = this;
      return OK(async function(...args) {
        const error = new ZodError([]);
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
          error.addIssue(makeArgsIssue(args, e));
          throw error;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error.addIssue(makeReturnsIssue(result, e));
          throw error;
        });
        return parsedReturns;
      });
    } else {
      const me = this;
      return OK(function(...args) {
        const parsedArgs = me._def.args.safeParse(args, params);
        if (!parsedArgs.success) {
          throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
        }
        const result = Reflect.apply(fn, this, parsedArgs.data);
        const parsedReturns = me._def.returns.safeParse(result, params);
        if (!parsedReturns.success) {
          throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
        }
        return parsedReturns.data;
      });
    }
  }
  parameters() {
    return this._def.args;
  }
  returnType() {
    return this._def.returns;
  }
  args(...items) {
    return new _ZodFunction({
      ...this._def,
      args: ZodTuple.create(items).rest(ZodUnknown.create())
    });
  }
  returns(returnType) {
    return new _ZodFunction({
      ...this._def,
      returns: returnType
    });
  }
  implement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  strictImplement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  static create(args, returns, params) {
    return new _ZodFunction({
      args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
      returns: returns || ZodUnknown.create(),
      typeName: ZodFirstPartyTypeKind.ZodFunction,
      ...processCreateParams(params)
    });
  }
};
var ZodLazy = class extends ZodType {
  get schema() {
    return this._def.getter();
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const lazySchema = this._def.getter();
    return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
  }
};
ZodLazy.create = (getter, params) => {
  return new ZodLazy({
    getter,
    typeName: ZodFirstPartyTypeKind.ZodLazy,
    ...processCreateParams(params)
  });
};
var ZodLiteral = class extends ZodType {
  _parse(input) {
    if (input.data !== this._def.value) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_literal,
        expected: this._def.value
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
  get value() {
    return this._def.value;
  }
};
ZodLiteral.create = (value, params) => {
  return new ZodLiteral({
    value,
    typeName: ZodFirstPartyTypeKind.ZodLiteral,
    ...processCreateParams(params)
  });
};
function createZodEnum(values, params) {
  return new ZodEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}
var ZodEnum = class _ZodEnum extends ZodType {
  _parse(input) {
    if (typeof input.data !== "string") {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(this._def.values);
    }
    if (!this._cache.has(input.data)) {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get options() {
    return this._def.values;
  }
  get enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Values() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  extract(values, newDef = this._def) {
    return _ZodEnum.create(values, {
      ...this._def,
      ...newDef
    });
  }
  exclude(values, newDef = this._def) {
    return _ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
      ...this._def,
      ...newDef
    });
  }
};
ZodEnum.create = createZodEnum;
var ZodNativeEnum = class extends ZodType {
  _parse(input) {
    const nativeEnumValues = util.getValidEnumValues(this._def.values);
    const ctx = this._getOrReturnCtx(input);
    if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(util.getValidEnumValues(this._def.values));
    }
    if (!this._cache.has(input.data)) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get enum() {
    return this._def.values;
  }
};
ZodNativeEnum.create = (values, params) => {
  return new ZodNativeEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
    ...processCreateParams(params)
  });
};
var ZodPromise = class extends ZodType {
  unwrap() {
    return this._def.type;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.promise,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
    return OK(promisified.then((data2) => {
      return this._def.type.parseAsync(data2, {
        path: ctx.path,
        errorMap: ctx.common.contextualErrorMap
      });
    }));
  }
};
ZodPromise.create = (schema, params) => {
  return new ZodPromise({
    type: schema,
    typeName: ZodFirstPartyTypeKind.ZodPromise,
    ...processCreateParams(params)
  });
};
var ZodEffects = class extends ZodType {
  innerType() {
    return this._def.schema;
  }
  sourceType() {
    return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const effect = this._def.effect || null;
    const checkCtx = {
      addIssue: (arg) => {
        addIssueToContext(ctx, arg);
        if (arg.fatal) {
          status.abort();
        } else {
          status.dirty();
        }
      },
      get path() {
        return ctx.path;
      }
    };
    checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
    if (effect.type === "preprocess") {
      const processed = effect.transform(ctx.data, checkCtx);
      if (ctx.common.async) {
        return Promise.resolve(processed).then(async (processed2) => {
          if (status.value === "aborted")
            return INVALID;
          const result = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID;
          if (result.status === "dirty")
            return DIRTY(result.value);
          if (status.value === "dirty")
            return DIRTY(result.value);
          return result;
        });
      } else {
        if (status.value === "aborted")
          return INVALID;
        const result = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result.status === "aborted")
          return INVALID;
        if (result.status === "dirty")
          return DIRTY(result.value);
        if (status.value === "dirty")
          return DIRTY(result.value);
        return result;
      }
    }
    if (effect.type === "refinement") {
      const executeRefinement = (acc) => {
        const result = effect.refinement(acc, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(result);
        }
        if (result instanceof Promise) {
          throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
        }
        return acc;
      };
      if (ctx.common.async === false) {
        const inner = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inner.status === "aborted")
          return INVALID;
        if (inner.status === "dirty")
          status.dirty();
        executeRefinement(inner.value);
        return { status: status.value, value: inner.value };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
          if (inner.status === "aborted")
            return INVALID;
          if (inner.status === "dirty")
            status.dirty();
          return executeRefinement(inner.value).then(() => {
            return { status: status.value, value: inner.value };
          });
        });
      }
    }
    if (effect.type === "transform") {
      if (ctx.common.async === false) {
        const base = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (!isValid(base))
          return INVALID;
        const result = effect.transform(base.value, checkCtx);
        if (result instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status.value, value: result };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
          if (!isValid(base))
            return INVALID;
          return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
            status: status.value,
            value: result
          }));
        });
      }
    }
    util.assertNever(effect);
  }
};
ZodEffects.create = (schema, effect, params) => {
  return new ZodEffects({
    schema,
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    effect,
    ...processCreateParams(params)
  });
};
ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
  return new ZodEffects({
    schema,
    effect: { type: "preprocess", transform: preprocess },
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    ...processCreateParams(params)
  });
};
var ZodOptional = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.undefined) {
      return OK(void 0);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodOptional.create = (type, params) => {
  return new ZodOptional({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodOptional,
    ...processCreateParams(params)
  });
};
var ZodNullable = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.null) {
      return OK(null);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodNullable.create = (type, params) => {
  return new ZodNullable({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodNullable,
    ...processCreateParams(params)
  });
};
var ZodDefault = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    let data2 = ctx.data;
    if (ctx.parsedType === ZodParsedType.undefined) {
      data2 = this._def.defaultValue();
    }
    return this._def.innerType._parse({
      data: data2,
      path: ctx.path,
      parent: ctx
    });
  }
  removeDefault() {
    return this._def.innerType;
  }
};
ZodDefault.create = (type, params) => {
  return new ZodDefault({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default,
    ...processCreateParams(params)
  });
};
var ZodCatch = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const newCtx = {
      ...ctx,
      common: {
        ...ctx.common,
        issues: []
      }
    };
    const result = this._def.innerType._parse({
      data: newCtx.data,
      path: newCtx.path,
      parent: {
        ...newCtx
      }
    });
    if (isAsync(result)) {
      return result.then((result2) => {
        return {
          status: "valid",
          value: result2.status === "valid" ? result2.value : this._def.catchValue({
            get error() {
              return new ZodError(newCtx.common.issues);
            },
            input: newCtx.data
          })
        };
      });
    } else {
      return {
        status: "valid",
        value: result.status === "valid" ? result.value : this._def.catchValue({
          get error() {
            return new ZodError(newCtx.common.issues);
          },
          input: newCtx.data
        })
      };
    }
  }
  removeCatch() {
    return this._def.innerType;
  }
};
ZodCatch.create = (type, params) => {
  return new ZodCatch({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
    ...processCreateParams(params)
  });
};
var ZodNaN = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.nan) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.nan,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
};
ZodNaN.create = (params) => {
  return new ZodNaN({
    typeName: ZodFirstPartyTypeKind.ZodNaN,
    ...processCreateParams(params)
  });
};
var BRAND = /* @__PURE__ */ Symbol("zod_brand");
var ZodBranded = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const data2 = ctx.data;
    return this._def.type._parse({
      data: data2,
      path: ctx.path,
      parent: ctx
    });
  }
  unwrap() {
    return this._def.type;
  }
};
var ZodPipeline = class _ZodPipeline extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.common.async) {
      const handleAsync = async () => {
        const inResult = await this._def.in._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inResult.status === "aborted")
          return INVALID;
        if (inResult.status === "dirty") {
          status.dirty();
          return DIRTY(inResult.value);
        } else {
          return this._def.out._parseAsync({
            data: inResult.value,
            path: ctx.path,
            parent: ctx
          });
        }
      };
      return handleAsync();
    } else {
      const inResult = this._def.in._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
      if (inResult.status === "aborted")
        return INVALID;
      if (inResult.status === "dirty") {
        status.dirty();
        return {
          status: "dirty",
          value: inResult.value
        };
      } else {
        return this._def.out._parseSync({
          data: inResult.value,
          path: ctx.path,
          parent: ctx
        });
      }
    }
  }
  static create(a, b) {
    return new _ZodPipeline({
      in: a,
      out: b,
      typeName: ZodFirstPartyTypeKind.ZodPipeline
    });
  }
};
var ZodReadonly = class extends ZodType {
  _parse(input) {
    const result = this._def.innerType._parse(input);
    const freeze = (data2) => {
      if (isValid(data2)) {
        data2.value = Object.freeze(data2.value);
      }
      return data2;
    };
    return isAsync(result) ? result.then((data2) => freeze(data2)) : freeze(result);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodReadonly.create = (type, params) => {
  return new ZodReadonly({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodReadonly,
    ...processCreateParams(params)
  });
};
function cleanParams(params, data2) {
  const p = typeof params === "function" ? params(data2) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
function custom(check, _params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data2, ctx) => {
      const r = check(data2);
      if (r instanceof Promise) {
        return r.then((r2) => {
          if (!r2) {
            const params = cleanParams(_params, data2);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
        const params = cleanParams(_params, data2);
        const _fatal = params.fatal ?? fatal ?? true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny.create();
}
var late = {
  object: ZodObject.lazycreate
};
var ZodFirstPartyTypeKind;
(function(ZodFirstPartyTypeKind2) {
  ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
  ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
  ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
  ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
  ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
  ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
  ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
  ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
  ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
  ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
  ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
  ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
  ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
  ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
  ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
  ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
  ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
  ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
  ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
  ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
  ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
  ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
  ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
  ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
  ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
  ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
  ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
  ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
  ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
  ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
  ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
  ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
  ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
  ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
  ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
  ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
var instanceOfType = (cls, params = {
  message: `Input not instance of ${cls.name}`
}) => custom((data2) => data2 instanceof cls, params);
var stringType = ZodString.create;
var numberType = ZodNumber.create;
var nanType = ZodNaN.create;
var bigIntType = ZodBigInt.create;
var booleanType = ZodBoolean.create;
var dateType = ZodDate.create;
var symbolType = ZodSymbol.create;
var undefinedType = ZodUndefined.create;
var nullType = ZodNull.create;
var anyType = ZodAny.create;
var unknownType = ZodUnknown.create;
var neverType = ZodNever.create;
var voidType = ZodVoid.create;
var arrayType = ZodArray.create;
var objectType = ZodObject.create;
var strictObjectType = ZodObject.strictCreate;
var unionType = ZodUnion.create;
var discriminatedUnionType = ZodDiscriminatedUnion.create;
var intersectionType = ZodIntersection.create;
var tupleType = ZodTuple.create;
var recordType = ZodRecord.create;
var mapType = ZodMap.create;
var setType = ZodSet.create;
var functionType = ZodFunction.create;
var lazyType = ZodLazy.create;
var literalType = ZodLiteral.create;
var enumType = ZodEnum.create;
var nativeEnumType = ZodNativeEnum.create;
var promiseType = ZodPromise.create;
var effectsType = ZodEffects.create;
var optionalType = ZodOptional.create;
var nullableType = ZodNullable.create;
var preprocessType = ZodEffects.createWithPreprocess;
var pipelineType = ZodPipeline.create;
var ostring = () => stringType().optional();
var onumber = () => numberType().optional();
var oboolean = () => booleanType().optional();
var coerce = {
  string: ((arg) => ZodString.create({ ...arg, coerce: true })),
  number: ((arg) => ZodNumber.create({ ...arg, coerce: true })),
  boolean: ((arg) => ZodBoolean.create({
    ...arg,
    coerce: true
  })),
  bigint: ((arg) => ZodBigInt.create({ ...arg, coerce: true })),
  date: ((arg) => ZodDate.create({ ...arg, coerce: true }))
};
var NEVER = INVALID;

// packages/config/dist/schema.js
var xiraniteConfigSchema = external_exports.object({
  workspace: external_exports.object({ default: external_exports.string().optional() }).optional(),
  paths: external_exports.object({
    data_dir: external_exports.string().optional(),
    database: external_exports.string().optional()
  }).optional(),
  app: external_exports.record(external_exports.string(), external_exports.unknown()).optional(),
  webview2: external_exports.object({
    features: external_exports.array(external_exports.string()).default([]),
    switches: external_exports.array(external_exports.string()).default([])
  }).optional(),
  nodes: external_exports.record(external_exports.string(), external_exports.unknown()).optional()
}).passthrough();

// packages/nodes/dissolvef/src/platform.ts
function createNodeDissolvefRuntime() {
  return {
    pathInfo,
    listDir,
    ensureDir: (path) => mkdir(path, { recursive: true }).then(() => void 0),
    movePath,
    deletePath,
    readText,
    writeText,
    join,
    dirname,
    basename,
    now: () => /* @__PURE__ */ new Date(),
    randomId: () => crypto.randomUUID().slice(0, 8),
    defaultHistoryPath: () => {
      const configPath = resolveXiraniteConfigPath();
      const dataDir = dirname(configPath);
      return join(dataDir, "artifacts", "undo", "dissolvef.undo.json");
    }
  };
}
async function pathInfo(path) {
  const resolved = resolve(path);
  try {
    const stat = await lstat(resolved);
    return { path: resolved, exists: true, isFile: stat.isFile(), isDirectory: stat.isDirectory() };
  } catch {
    return { path: resolved, exists: false, isFile: false, isDirectory: false };
  }
}
async function listDir(path) {
  const entries = await readdir(path, { withFileTypes: true });
  return entries.map((entry) => ({
    name: entry.name,
    path: join(path, entry.name),
    isFile: entry.isFile(),
    isDirectory: entry.isDirectory()
  }));
}
async function movePath(source, target) {
  await mkdir(dirname(target), { recursive: true });
  try {
    await rename(source, target);
  } catch {
    await cp(source, target, { recursive: true, force: false, errorOnExist: true });
    await rm(source, { recursive: true, force: true });
  }
}
async function deletePath(path, recursive = false) {
  if (recursive) {
    await rm(path, { recursive: true, force: false });
    return;
  }
  const info = await pathInfo(path);
  if (info.isDirectory) await rmdir(path);
  else await rm(path, { force: false });
}
async function readText(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}
async function writeText(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}
export {
  createNodeDissolvefRuntime,
  runDissolvef
};
/*! Bundled license information:

smol-toml/dist/date.js:
smol-toml/dist/error.js:
smol-toml/dist/primitive.js:
smol-toml/dist/util.js:
smol-toml/dist/extract.js:
smol-toml/dist/struct.js:
smol-toml/dist/parse.js:
smol-toml/dist/stringify.js:
smol-toml/dist/index.js:
  (*!
   * Copyright (c) Squirrel Chat et al., All rights reserved.
   * SPDX-License-Identifier: BSD-3-Clause
   *
   * Redistribution and use in source and binary forms, with or without
   * modification, are permitted provided that the following conditions are met:
   *
   * 1. Redistributions of source code must retain the above copyright notice, this
   *    list of conditions and the following disclaimer.
   * 2. Redistributions in binary form must reproduce the above copyright notice,
   *    this list of conditions and the following disclaimer in the
   *    documentation and/or other materials provided with the distribution.
   * 3. Neither the name of the copyright holder nor the names of its contributors
   *    may be used to endorse or promote products derived from this software without
   *    specific prior written permission.
   *
   * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
   * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
   * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
   * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
   * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
   * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
   * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
   * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
   * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
   * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
   *)
*/
