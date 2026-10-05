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
  const clean = value.length % 2 === 0 ? value : value.slice(0, value.length - 1);
  const out = new Uint8Array(Math.floor(clean.length / 2));
  for (let index = 0; index < out.length; index += 1) {
    const byte = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16);
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

// packages/nodes/bitv/src/core.ts
var BITV_DEFAULTS = {
  recursive: true,
  bitrateStepMbps: 5,
  maxLevels: 10,
  transferMode: "copy",
  dryRun: true
};
var BITV_VIDEO_EXTENSIONS = /* @__PURE__ */ new Set([
  ".mp4",
  ".avi",
  ".mkv",
  ".mov",
  ".wmv",
  ".flv",
  ".webm",
  ".m4v",
  ".mpg",
  ".mpeg",
  ".ogv",
  ".ts",
  ".mts",
  ".m2ts"
]);
function createBitrateLevels(bitrateStepMbps = BITV_DEFAULTS.bitrateStepMbps, maxLevels = BITV_DEFAULTS.maxLevels) {
  assertBitrateSettings(bitrateStepMbps, maxLevels);
  const levels = Array.from({ length: maxLevels }, (_, index) => {
    const thresholdMbps = (index + 1) * bitrateStepMbps;
    return {
      label: `${formatThreshold(thresholdMbps)}Mbps`,
      thresholdBps: thresholdMbps * 1e6
    };
  });
  const maximum = maxLevels * bitrateStepMbps;
  levels.push({ label: `over-${formatThreshold(maximum)}Mbps`, thresholdBps: Number.POSITIVE_INFINITY });
  return levels;
}
function bitrateLevelFor(bitrateBps, levels) {
  return levels.find((level) => bitrateBps <= level.thresholdBps)?.label ?? levels.at(-1)?.label ?? "unknown";
}
function isBitvVideoPath(path) {
  const filename = basename(path).toLowerCase();
  const index = filename.lastIndexOf(".");
  return index >= 0 && BITV_VIDEO_EXTENSIONS.has(filename.slice(index));
}
function parseBitvPaths(paths) {
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const item of paths ?? []) {
    for (const line of item.split(/\r?\n/)) {
      const path = line.trim().replace(/^['"]|['"]$/g, "");
      if (!path || seen.has(path)) continue;
      seen.add(path);
      result.push(path);
    }
  }
  return result;
}
function parseFfprobeVideo(path, relativePath, fileStat, rawProbe, levels) {
  const probe = asRecord(rawProbe);
  const streams = Array.isArray(probe?.streams) ? probe.streams.map(asRecord).filter(isRecord) : [];
  const video = streams.find((stream) => stream.codec_type === "video");
  if (!video) throw new Error("ffprobe returned no video stream");
  const format = asRecord(probe?.format);
  const durationSeconds = firstPositiveNumber(format?.duration, video.duration);
  if (!(durationSeconds > 0)) throw new Error("ffprobe returned no positive duration");
  if (!(fileStat.sizeBytes >= 0) || !Number.isFinite(fileStat.sizeBytes)) throw new Error("file size is invalid");
  const width = nonNegativeInteger(video.width);
  const height = nonNegativeInteger(video.height);
  const fps = parseFrameRate(video.avg_frame_rate ?? video.r_frame_rate);
  const bitrateBps = fileStat.sizeBytes * 8 / durationSeconds;
  return {
    path,
    relativePath: safeRelativePath(relativePath, basename(path)),
    filename: basename(path),
    durationSeconds,
    bitrateBps,
    bitrateMbps: bitrateBps / 1e6,
    width,
    height,
    fps,
    sizeBytes: fileStat.sizeBytes,
    resolution: `${width}x${height}`,
    bitrateLevel: bitrateLevelFor(bitrateBps, levels)
  };
}
async function runBitv(input, runtime, onEvent = () => {
}) {
  const action = input.action ?? "status";
  const requestedPaths = parseBitvPaths(input.paths);
  const dryRun = input.dryRun !== false;
  const base = emptyData(action, requestedPaths, dryRun);
  if (action === "status") {
    const ffprobePath2 = await runtime.findFfprobe();
    if (!ffprobePath2) {
      return { success: false, message: "ffprobe was not found on this system.", data: base };
    }
    return {
      success: true,
      message: `ffprobe is ready: ${ffprobePath2}`,
      data: { ...base, ffprobePath: ffprobePath2 }
    };
  }
  const settingsError = validateBitrateSettings(input.bitrateStepMbps, input.maxLevels);
  if (settingsError) return { success: false, message: settingsError, data: base };
  const bitrateStepMbps = input.bitrateStepMbps ?? BITV_DEFAULTS.bitrateStepMbps;
  const maxLevels = input.maxLevels ?? BITV_DEFAULTS.maxLevels;
  const levels = createBitrateLevels(bitrateStepMbps, maxLevels);
  if (action === "report") {
    return runReportClassification(input, runtime, levels, base, onEvent);
  }
  if (requestedPaths.length === 0) {
    return { success: false, message: "Provide at least one video file or directory path.", data: base };
  }
  const ffprobePath = await runtime.findFfprobe();
  if (!ffprobePath) {
    return { success: false, message: "ffprobe was not found on this system.", data: base };
  }
  const recursive = input.recursive ?? BITV_DEFAULTS.recursive;
  onEvent({ type: "progress", progress: 0, message: "Scanning video paths." });
  const discovery = await runtime.discoverVideos(requestedPaths, recursive);
  if (discovery.files.length === 0) {
    const errors2 = discovery.errors.length ? discovery.errors : ["No supported video files were found."];
    return {
      success: false,
      message: "No supported video files were found.",
      data: { ...base, ffprobePath, errors: errors2 }
    };
  }
  const analysis = await analyzeVideos(discovery.files, ffprobePath, levels, runtime, onEvent);
  const errors = [...discovery.errors, ...analysis.errors];
  const stats = summarizeVideos(analysis.videos);
  if (action === "analyze") {
    let reportPath;
    if (input.outputPath?.trim()) {
      const report = createAnalysisReport(
        requestedPaths,
        recursive,
        bitrateStepMbps,
        maxLevels,
        analysis.videos,
        stats,
        runtime.now()
      );
      try {
        reportPath = await runtime.writeJson(input.outputPath.trim(), report);
      } catch (error) {
        errors.push(`Report: ${errorMessage(error)}`);
      }
    }
    const success2 = analysis.videos.length > 0 && errors.length === 0;
    onEvent({ type: "progress", progress: 100, message: "Video analysis completed." });
    return {
      success: success2,
      message: success2 ? `Analyzed ${analysis.videos.length} video(s).` : `Analyzed ${analysis.videos.length} video(s) with ${errors.length} error(s).`,
      data: {
        ...base,
        ffprobePath,
        videos: analysis.videos,
        stats,
        reportPath,
        errors
      }
    };
  }
  const targetPath = input.targetPath?.trim();
  if (!targetPath) {
    return {
      success: false,
      message: "Classify requires a target directory.",
      data: { ...base, ffprobePath, videos: analysis.videos, stats, errors }
    };
  }
  const operations = await classifyVideos(
    analysis.videos,
    targetPath,
    input.transferMode ?? BITV_DEFAULTS.transferMode,
    dryRun,
    runtime,
    onEvent
  );
  errors.push(...operations.flatMap((operation) => operation.error ? [operation.error] : []));
  const success = analysis.videos.length > 0 && errors.length === 0;
  onEvent({ type: "progress", progress: 100, message: dryRun ? "Classification preview completed." : "Classification completed." });
  return {
    success,
    message: dryRun ? `Planned ${operations.length} classification operation(s); no files were changed.` : success ? `Classified ${operations.length} video(s).` : `Classified ${operations.filter((operation) => operation.success).length} video(s) with ${errors.length} error(s).`,
    data: { ...base, ffprobePath, videos: analysis.videos, stats, operations, errors }
  };
}
function createAnalysisReport(requestedPaths, recursive, bitrateStepMbps, maxLevels, videos, stats, now) {
  return {
    schemaVersion: 1,
    createdAt: now.toISOString(),
    requestedPaths: [...requestedPaths],
    recursive,
    bitrateStepMbps,
    maxLevels,
    videos: videos.map((video) => ({ ...video })),
    stats: { ...stats, bitrateDistribution: { ...stats.bitrateDistribution } }
  };
}
function normalizeBitvReport(value, fallbackCreatedAt = (/* @__PURE__ */ new Date(0)).toISOString()) {
  const record = asRecord(value);
  if (!record) throw new Error("Report must be a JSON object.");
  const rawVideos = Array.isArray(record.videos) ? record.videos : [];
  const videos = rawVideos.map((item) => normalizeReportVideo(item)).filter((item) => Boolean(item));
  if (videos.length === 0) throw new Error("Report contains no usable videos.");
  const legacyFolder = stringValue(record.folder_path);
  const requestedPaths = stringArray(record.requestedPaths);
  if (requestedPaths.length === 0 && legacyFolder) requestedPaths.push(legacyFolder);
  const bitrateStepMbps = positiveNumber(record.bitrateStepMbps) ?? BITV_DEFAULTS.bitrateStepMbps;
  const maxLevels = positiveInteger(record.maxLevels) ?? BITV_DEFAULTS.maxLevels;
  return {
    schemaVersion: 1,
    createdAt: stringValue(record.createdAt) || stringValue(record.timestamp) || fallbackCreatedAt,
    requestedPaths,
    recursive: typeof record.recursive === "boolean" ? record.recursive : BITV_DEFAULTS.recursive,
    bitrateStepMbps,
    maxLevels,
    videos,
    stats: summarizeVideos(videos)
  };
}
function summarizeVideos(videos) {
  const bitrateDistribution = {};
  let totalSizeBytes = 0;
  let totalDurationSeconds = 0;
  let totalBitrateMbps = 0;
  for (const video of videos) {
    totalSizeBytes += video.sizeBytes;
    totalDurationSeconds += video.durationSeconds;
    totalBitrateMbps += video.bitrateMbps;
    bitrateDistribution[video.bitrateLevel] = (bitrateDistribution[video.bitrateLevel] ?? 0) + 1;
  }
  return {
    totalVideos: videos.length,
    totalSizeBytes,
    totalDurationSeconds,
    averageBitrateMbps: videos.length > 0 ? totalBitrateMbps / videos.length : 0,
    bitrateDistribution
  };
}
async function runReportClassification(input, runtime, levels, base, onEvent) {
  const reportPath = input.reportPath?.trim() || parseBitvPaths(input.paths)[0];
  if (!reportPath) return { success: false, message: "Report classification requires a JSON report path.", data: base };
  let report;
  try {
    report = normalizeBitvReport(await runtime.readJson(reportPath), runtime.now().toISOString());
  } catch (error) {
    return {
      success: false,
      message: `Unable to read BitV report: ${errorMessage(error)}`,
      data: { ...base, reportPath, errors: [errorMessage(error)] }
    };
  }
  const videos = report.videos.map((video) => ({
    ...video,
    bitrateLevel: video.bitrateBps > 0 ? bitrateLevelFor(video.bitrateBps, levels) : video.bitrateLevel
  }));
  const targetPath = input.targetPath?.trim() || runtime.dirname(reportPath);
  const dryRun = input.dryRun !== false;
  const operations = await classifyVideos(
    videos,
    targetPath,
    input.transferMode ?? BITV_DEFAULTS.transferMode,
    dryRun,
    runtime,
    onEvent
  );
  const errors = operations.flatMap((operation) => operation.error ? [operation.error] : []);
  const success = operations.length > 0 && errors.length === 0;
  onEvent({ type: "progress", progress: 100, message: dryRun ? "Report classification preview completed." : "Report classification completed." });
  return {
    success,
    message: dryRun ? `Planned ${operations.length} report classification operation(s); no files were changed.` : success ? `Classified ${operations.length} video(s) from report.` : `Classified ${operations.filter((operation) => operation.success).length} report video(s) with ${errors.length} error(s).`,
    data: {
      ...base,
      requestedPaths: [reportPath],
      videos,
      stats: summarizeVideos(videos),
      operations,
      reportPath,
      errors
    }
  };
}
async function analyzeVideos(files, ffprobePath, levels, runtime, onEvent) {
  const videos = [];
  const errors = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const progress = Math.round(5 + index / files.length * 65);
    onEvent({ type: "progress", progress, message: `Analyzing ${basename(file.path)}.` });
    try {
      const [fileStat, probe] = await Promise.all([
        runtime.statFile(file.path),
        runtime.runFfprobeJson(ffprobePath, file.path)
      ]);
      videos.push(parseFfprobeVideo(file.path, file.relativePath, fileStat, probe, levels));
    } catch (error) {
      errors.push(`${file.path}: ${errorMessage(error)}`);
    }
  }
  return { videos, errors };
}
async function classifyVideos(videos, targetPath, mode, dryRun, runtime, onEvent) {
  const operations = [];
  for (let index = 0; index < videos.length; index += 1) {
    const video = videos[index];
    const desiredPath = joinPath(targetPath, safePathSegment(video.bitrateLevel), safeRelativePath(video.relativePath, video.filename));
    const progress = Math.round(72 + index / videos.length * 26);
    onEvent({ type: "progress", progress, message: `${dryRun ? "Planning" : mode === "move" ? "Moving" : "Copying"} ${video.filename}.` });
    try {
      const actualPath = dryRun ? await runtime.resolveAvailablePath(desiredPath) : await runtime.transferFile(video.path, desiredPath, mode);
      operations.push({
        mode,
        sourcePath: video.path,
        desiredPath,
        targetPath: actualPath,
        bitrateLevel: video.bitrateLevel,
        dryRun,
        success: true
      });
    } catch (error) {
      const message = `${video.path}: ${errorMessage(error)}`;
      operations.push({
        mode,
        sourcePath: video.path,
        desiredPath,
        targetPath: desiredPath,
        bitrateLevel: video.bitrateLevel,
        dryRun,
        success: false,
        error: message
      });
    }
  }
  return operations;
}
function normalizeReportVideo(value) {
  const record = asRecord(value);
  if (!record) return null;
  const info = asRecord(record.info) ?? record;
  const path = stringValue(record.path) || stringValue(info.path);
  if (!path) return null;
  const durationSeconds = nonNegativeNumber(info.durationSeconds ?? info.duration);
  const bitrateMbps = nonNegativeNumber(info.bitrateMbps ?? info.bitrate_mbps);
  const bitrateBps = nonNegativeNumber(info.bitrateBps ?? info.bitrate) || bitrateMbps * 1e6;
  const sizeBytes = nonNegativeNumber(info.sizeBytes ?? info.size_bytes) || nonNegativeNumber(info.size_mb) * 1024 * 1024;
  const width = nonNegativeInteger(info.width);
  const height = nonNegativeInteger(info.height);
  const fps = nonNegativeNumber(info.fps);
  const bitrateLevel = stringValue(record.bitrateLevel) || stringValue(record.bitrate_level) || "unknown";
  return {
    path,
    relativePath: safeRelativePath(stringValue(record.relativePath), basename(path)),
    filename: stringValue(info.filename) || basename(path),
    durationSeconds,
    bitrateBps,
    bitrateMbps: bitrateMbps || bitrateBps / 1e6,
    width,
    height,
    fps,
    sizeBytes,
    resolution: stringValue(info.resolution) || `${width}x${height}`,
    bitrateLevel
  };
}
function emptyData(action, requestedPaths, dryRun) {
  return {
    action,
    requestedPaths,
    videos: [],
    stats: summarizeVideos([]),
    operations: [],
    dryRun,
    errors: []
  };
}
function validateBitrateSettings(step, levels) {
  const bitrateStepMbps = step ?? BITV_DEFAULTS.bitrateStepMbps;
  const maxLevels = levels ?? BITV_DEFAULTS.maxLevels;
  if (!Number.isFinite(bitrateStepMbps) || bitrateStepMbps <= 0) return "Bitrate step must be greater than zero.";
  if (!Number.isInteger(maxLevels) || maxLevels <= 0 || maxLevels > 1e3) return "Bitrate levels must be an integer between 1 and 1000.";
  return null;
}
function assertBitrateSettings(step, levels) {
  const error = validateBitrateSettings(step, levels);
  if (error) throw new RangeError(error);
}
function parseFrameRate(value) {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : 0;
  if (typeof value !== "string" || !value.trim()) return 0;
  const [numeratorText, denominatorText] = value.split("/", 2);
  const numerator = Number(numeratorText);
  const denominator = denominatorText === void 0 ? 1 : Number(denominatorText);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return 0;
  const result = numerator / denominator;
  return Number.isFinite(result) && result >= 0 ? result : 0;
}
function firstPositiveNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 0;
}
function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : void 0;
}
function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : void 0;
}
function nonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}
function nonNegativeInteger(value) {
  return Math.floor(nonNegativeNumber(value));
}
function safePathSegment(value) {
  const invalid = /* @__PURE__ */ new Set(["<", ">", ":", '"', "/", "\\", "|", "?", "*"]);
  const sanitized = Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || invalid.has(character) ? "_" : character;
  }).join("");
  return sanitized.replace(/[. ]+$/g, "") || "unknown";
}
function safeRelativePath(value, fallback) {
  const parts = value.split(/[\\/]+/).filter((part) => part && part !== "." && part !== "..");
  return (parts.length ? parts : [fallback]).map(safePathSegment).join("/");
}
function joinPath(...parts) {
  const first = parts.find(Boolean) ?? "";
  const separator = first.includes("\\") && !first.includes("/") ? "\\" : "/";
  const joined = parts.filter(Boolean).map((part, index) => index === 0 ? part.replace(/[\\/]+$/g, "") : part.replace(/^[\\/]+|[\\/]+$/g, "")).filter(Boolean).join(separator);
  return first === "/" ? `/${joined}` : joined;
}
function basename(path) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}
function formatThreshold(value) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}
function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}
function stringArray(value) {
  return Array.isArray(value) ? value.map(stringValue).filter(Boolean) : [];
}
function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}
function isRecord(value) {
  return value !== null;
}
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
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
async function writeFile(path, data, options) {
  const target = toPathString(path, "fs.promises.writeFile");
  const normalized = normalizeEncodingOption(options);
  checkTextEncoding(normalized.encoding, "fs.promises.writeFile");
  const content = rejectBinaryPayload(data, "fs.promises.writeFile");
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
    const exists = await opFsStatAsync(target).then((info) => info.exists !== false, () => false);
    if (!exists) return;
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
var basename2 = (path, suffix) => basenameWith(path, native(), suffix);
var extname = (path) => extnameWith(path, native());
var _makeLong = notImplemented("path", "_makeLong");

// packages/nodes/bitv/src/platform.ts
function createNodeBitvRuntime(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  return {
    findFfprobe: () => findFfprobe(cwd, env),
    discoverVideos: (paths, recursive) => discoverVideos(paths, recursive, cwd),
    async statFile(path) {
      const file = await stat(resolveFrom(cwd, path));
      if (!file.isFile()) throw new Error("Path is not a file.");
      return { sizeBytes: file.size };
    },
    async runFfprobeJson(ffprobePath, path) {
      const result = await exec2(ffprobePath, [
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        resolveFrom(cwd, path)
      ], cwd, env);
      if (result.code !== 0) throw new Error(shortProcessError(result, "ffprobe failed"));
      try {
        return JSON.parse(result.stdout);
      } catch (error) {
        throw new Error(`ffprobe returned invalid JSON: ${errorMessage2(error)}`);
      }
    },
    async readJson(path) {
      return JSON.parse(await readFile(resolveFrom(cwd, path), "utf8"));
    },
    writeJson: (desiredPath, value) => writeJsonExclusive(resolveFrom(cwd, desiredPath), value),
    resolveAvailablePath: (desiredPath) => findAvailablePath(resolveFrom(cwd, desiredPath)),
    transferFile: (sourcePath, desiredPath, mode) => transferFileExclusive(
      resolveFrom(cwd, sourcePath),
      resolveFrom(cwd, desiredPath),
      mode
    ),
    now: options.now ?? (() => /* @__PURE__ */ new Date()),
    dirname
  };
}
async function findFfprobe(cwd = process.cwd(), env = process.env) {
  const configured = env.BITV_FFPROBE_PATH?.trim();
  if (configured) {
    const path = resolveFrom(cwd, configured);
    if (await isFile(path)) return path;
  }
  const locator = process.platform === "win32" ? "where.exe" : "which";
  const result = await exec2(locator, ["ffprobe"], cwd, env);
  if (result.code !== 0) return null;
  for (const line of result.stdout.split(/\r?\n/)) {
    const candidate = line.trim();
    if (candidate && await isFile(candidate)) return candidate;
  }
  return null;
}
async function discoverVideos(paths, recursive, cwd = process.cwd()) {
  const files = [];
  const errors = [];
  const seen = /* @__PURE__ */ new Set();
  for (const input of paths) {
    const path = resolveFrom(cwd, input);
    let info;
    try {
      info = await lstat(path);
    } catch (error) {
      errors.push(`${input}: ${errorMessage2(error)}`);
      continue;
    }
    if (info.isFile()) {
      if (!isBitvVideoPath(path)) {
        errors.push(`${input}: unsupported video extension`);
        continue;
      }
      addDiscoveredFile(files, seen, {
        path,
        basePath: dirname(path),
        relativePath: basename2(path)
      });
      continue;
    }
    if (!info.isDirectory()) {
      errors.push(`${input}: path is not a regular file or directory`);
      continue;
    }
    await walkVideoDirectory(path, path, recursive, files, seen, errors);
  }
  files.sort((left, right) => left.path.localeCompare(right.path, void 0, { sensitivity: "base" }));
  return { files, errors };
}
async function findAvailablePath(desiredPath) {
  for (let index = 0; ; index += 1) {
    const candidate = collisionCandidate(desiredPath, index);
    if (!await pathExists(candidate)) return candidate;
  }
}
async function transferFileExclusive(sourcePath, desiredPath, mode) {
  await mkdir(dirname(desiredPath), { recursive: true });
  for (let index = 0; ; index += 1) {
    const candidate = collisionCandidate(desiredPath, index);
    try {
      if (mode === "copy") {
        await copyFile(sourcePath, candidate, constants2.COPYFILE_EXCL);
      } else {
        await moveFileWithoutOverwrite(sourcePath, candidate);
      }
      return candidate;
    } catch (error) {
      if (isErrorCode(error, "EEXIST")) continue;
      throw error;
    }
  }
}
async function walkVideoDirectory(basePath, directory, recursive, files, seen, errors) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    errors.push(`${directory}: ${errorMessage2(error)}`);
    return;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (recursive) await walkVideoDirectory(basePath, path, recursive, files, seen, errors);
      continue;
    }
    if (!entry.isFile() || !isBitvVideoPath(path)) continue;
    addDiscoveredFile(files, seen, {
      path,
      basePath,
      relativePath: relative(basePath, path)
    });
  }
}
function addDiscoveredFile(files, seen, file) {
  const key = process.platform === "win32" ? file.path.toLowerCase() : file.path;
  if (seen.has(key)) return;
  seen.add(key);
  files.push(file);
}
async function writeJsonExclusive(desiredPath, value) {
  await mkdir(dirname(desiredPath), { recursive: true });
  const json = `${JSON.stringify(value, null, 2)}
`;
  for (let index = 0; ; index += 1) {
    const candidate = collisionCandidate(desiredPath, index);
    try {
      await writeFile(candidate, json, { encoding: "utf8", flag: "wx" });
      return candidate;
    } catch (error) {
      if (isErrorCode(error, "EEXIST")) continue;
      throw error;
    }
  }
}
async function moveFileWithoutOverwrite(sourcePath, targetPath) {
  try {
    await link(sourcePath, targetPath);
    await unlink(sourcePath);
    return;
  } catch (error) {
    if (isErrorCode(error, "EEXIST")) throw error;
    if (!isCrossDeviceOrUnsupported(error)) throw error;
  }
  await copyFile(sourcePath, targetPath, constants2.COPYFILE_EXCL);
  await unlink(sourcePath);
}
function collisionCandidate(path, index) {
  if (index === 0) return path;
  const extension = extname(path);
  const filename = basename2(path, extension);
  return join(dirname(path), `${filename} (${index})${extension}`);
}
function resolveFrom(cwd, path) {
  return resolve(cwd, path);
}
async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
async function pathExists(path) {
  try {
    await access(path, constants2.F_OK);
    return true;
  } catch {
    return false;
  }
}
function exec2(command, args, cwd, env) {
  return new Promise((resolveResult) => {
    execFile(command, args, {
      cwd,
      env,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 32,
      encoding: "utf8"
    }, (error, stdout, stderr) => {
      const code = typeof error?.code === "number" ? error.code : error ? 1 : 0;
      resolveResult({
        code,
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? (error instanceof Error ? error.message : ""))
      });
    });
  });
}
function shortProcessError(result, fallback) {
  const message = (result.stderr || result.stdout || fallback).trim();
  return message.length > 500 ? `${message.slice(0, 497)}...` : message;
}
function isCrossDeviceOrUnsupported(error) {
  return ["EXDEV", "EPERM", "EACCES", "ENOSYS", "ENOTSUP", "EOPNOTSUPP"].some((code) => isErrorCode(error, code));
}
function isErrorCode(error, code) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
function errorMessage2(error) {
  return error instanceof Error ? error.message : String(error);
}
export {
  createNodeBitvRuntime,
  runBitv
};
