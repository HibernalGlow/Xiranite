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

// packages/nodes/repacku/src/core.ts
var DEFAULT_FILE_TYPES = {
  text: [".txt", ".md", ".log", ".ini", ".cfg", ".conf", ".json", ".xml", ".yml", ".yaml", ".csv", ".convert", ".sha1"],
  image: [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tiff", ".webp", ".svg", ".ico", ".raw", ".jxl", ".avif", ".psd", ".sha1"],
  video: [".mp4", ".avi", ".mkv", ".mov", ".wmv", ".flv", ".webm", ".m4v", ".mpg", ".mpeg", ".nov"],
  audio: [".mp3", ".wav", ".ogg", ".flac", ".aac", ".wma", ".m4a", ".opus"],
  document: [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".odp"],
  archive: [".zip", ".rar", ".7z", ".tar", ".gz", ".bz2", ".xz", ".iso", ".cbz", ".cbr"],
  code: [".py", ".js", ".html", ".css", ".java", ".c", ".cpp", ".cs", ".php", ".go", ".rs", ".rb", ".ts"],
  font: [".ttf", ".otf", ".woff", ".woff2", ".eot"],
  executable: [".exe", ".dll", ".bat", ".sh", ".msi", ".app", ".apk"],
  model: [".pth", ".h5", ".pb", ".onnx", ".tflite", ".mlmodel", ".pt", ".bin", ".caffemodel"]
};
var BLACKLIST_KEYWORDS = [
  "node_modules",
  "__pycache__",
  ".git",
  ".svn",
  "tmp",
  "temp",
  "cache",
  "logs",
  ".vscode",
  ".idea",
  ".vs",
  "\u753B\u96C6",
  "\u52A8\u753B"
];
var DEFAULT_GALLERY_MARKER = ". \u753B\u96C6";
var IMAGE_EXTENSIONS = DEFAULT_FILE_TYPES.image;
function normalizeRepackuInput(input) {
  return {
    action: input.action ?? "full",
    paths: normalizePaths(input),
    configPath: clean(input.configPath ?? input.config_path),
    outputPath: clean(input.outputPath ?? input.output_path),
    targetFileTypes: normalizeTypes(input.targetFileTypes ?? input.target_file_types ?? input.types),
    deleteAfter: input.deleteAfter ?? input.delete_after ?? false,
    dryRun: input.dryRun ?? input.dry_run ?? false,
    minCount: Math.max(1, Math.floor(input.minCount ?? input.min_count ?? 2)),
    galleryMarker: clean(input.galleryMarker ?? input.gallery_marker) || DEFAULT_GALLERY_MARKER
  };
}
async function runRepacku(input, runtime, onEvent = () => {
}) {
  const normalized = normalizeRepackuInput(input);
  try {
    if (normalized.action === "analyze") return await runAnalyze(normalized, runtime, onEvent);
    if (normalized.action === "compress") return await runCompress(normalized, runtime, onEvent);
    if (normalized.action === "single-pack") return await runSinglePack(normalized, runtime, onEvent);
    if (normalized.action === "gallery-pack") return await runGalleryPack(normalized, runtime, onEvent);
    return await runFull(normalized, runtime, onEvent);
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error));
  }
}
async function analyzeFolderStructure(rootPath, runtime, options = {}) {
  const resolved = runtime.resolve(rootPath);
  const info = await runtime.pathInfo(resolved);
  if (!info.exists || !info.isDirectory) return null;
  return analyzeNode(resolved, "", 1, runtime, {
    targetFileTypes: options.targetFileTypes ?? [],
    minCount: Math.max(1, Math.floor(options.minCount ?? 2))
  });
}
function createRepackuConfig(rootPath, folderTree, runtime, options = {}) {
  const configPath = options.outputPath || runtime.join(rootPath, `${runtime.basename(rootPath)}_config.json`);
  return {
    configPath,
    config: {
      folderTree,
      config: {
        timestamp: runtime.now().toISOString(),
        targetFileTypes: options.targetFileTypes ?? [],
        minCount: Math.max(1, Math.floor(options.minCount ?? 2))
      }
    }
  };
}
function serializeRepackuConfig(config) {
  return `${JSON.stringify(config, null, 2)}
`;
}
function parseRepackuConfig(value) {
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid repacku config.");
  const record = parsed;
  const folderTree = normalizeFolderNode(record.folderTree ?? record.folder_tree);
  if (!folderTree) throw new Error("Config is missing folderTree.");
  const rawConfig = asRecord(record.config);
  return {
    folderTree,
    config: {
      timestamp: stringValue(rawConfig.timestamp) || (/* @__PURE__ */ new Date(0)).toISOString(),
      targetFileTypes: normalizeTypes(rawConfig.targetFileTypes ?? rawConfig.target_file_types),
      minCount: Math.max(1, Math.floor(numberValue(rawConfig.minCount ?? rawConfig.min_count, 2)))
    }
  };
}
function countCompressionModes(node) {
  const stats = { total: 0, entire: 0, selective: 0, skip: 0 };
  if (!node) return stats;
  visitFolders(node, (folder) => {
    stats.total += 1;
    stats[folder.compressMode] += 1;
  });
  return stats;
}
function collectCompressionOperations(config, runtime) {
  const operations = [];
  visitFolders(config.folderTree, (folder) => {
    if (folder.compressMode === "entire") {
      operations.push({
        mode: "entire",
        sourcePath: folder.path,
        targetPath: wholeFolderArchivePath(folder.path, runtime),
        extensions: [],
        fileCount: folder.totalFiles,
        status: "planned",
        originalSize: 0,
        compressedSize: 0
      });
      return;
    }
    if (folder.compressMode === "selective") {
      operations.push({
        mode: "selective",
        sourcePath: folder.path,
        targetPath: runtime.join(folder.path, `${runtime.basename(folder.path)}.zip`),
        extensions: Object.keys(folder.fileExtensions).sort(),
        fileCount: sumCounts(folder.fileExtensions),
        status: "planned",
        originalSize: 0,
        compressedSize: 0
      });
    }
  });
  return operations;
}
function getFileType(fileName) {
  const extension = getExtension(fileName);
  for (const [type, extensions] of Object.entries(DEFAULT_FILE_TYPES)) {
    if (extensions.includes(extension)) return type;
  }
  const lower = fileName.toLowerCase();
  if (lower.includes("readme") || lower.includes("license") || lower.includes("changelog")) return "text";
  return null;
}
function isFileInTypes(fileName, targetTypes) {
  if (!targetTypes.length) return true;
  const fileType = getFileType(fileName);
  if (fileType) return targetTypes.includes(fileType);
  const extension = getExtension(fileName);
  return targetTypes.some((type) => DEFAULT_FILE_TYPES[type]?.includes(extension));
}
function isArchiveFile(fileName) {
  return isFileInTypes(fileName, ["archive"]);
}
function isBlacklistedPath(path) {
  const lower = path.toLowerCase();
  return BLACKLIST_KEYWORDS.some((keyword) => lower.includes(keyword.toLowerCase()));
}
async function runAnalyze(normalized, runtime, onEvent) {
  const rootPath = normalized.paths[0];
  if (!rootPath) return failure("Path is required.");
  const bundle = await analyzeToConfig(rootPath, normalized, runtime, onEvent);
  return {
    success: true,
    message: `Analysis complete: ${bundle.stats.total} folder(s).`,
    data: dataFromAnalysis(bundle)
  };
}
async function runFull(normalized, runtime, onEvent) {
  const rootPath = normalized.paths[0];
  if (!rootPath) return failure("Path is required.");
  const bundle = await analyzeToConfig(rootPath, normalized, runtime, onEvent);
  const executed = await executeConfig(bundle.config, runtime, normalized, onEvent);
  const merged = mergeData(dataFromAnalysis(bundle), executed);
  return {
    success: executed.failedCount === 0,
    message: normalized.dryRun ? `Full plan complete: ${executed.plannedCount} operation(s).` : `Full repack complete: ${executed.compressedCount} succeeded, ${executed.failedCount} failed.`,
    data: merged
  };
}
async function runCompress(normalized, runtime, onEvent) {
  let configPath = normalized.configPath;
  let config;
  if (configPath) {
    onEvent({ type: "progress", progress: 10, message: "Reading config." });
    config = parseRepackuConfig(await runtime.readText(configPath));
  } else {
    const rootPath = normalized.paths[0];
    if (!rootPath) return failure("Config path or folder path is required.");
    const bundle = await analyzeToConfig(rootPath, normalized, runtime, onEvent);
    configPath = bundle.configPath;
    config = bundle.config;
  }
  const executed = await executeConfig(config, runtime, normalized, onEvent);
  return {
    success: executed.failedCount === 0,
    message: normalized.dryRun ? `Compression plan complete: ${executed.plannedCount} operation(s).` : `Compression complete: ${executed.compressedCount} succeeded, ${executed.failedCount} failed.`,
    data: {
      ...executed,
      configPath,
      folderTree: config.folderTree,
      ...statsToCounts(countCompressionModes(config.folderTree))
    }
  };
}
async function runSinglePack(normalized, runtime, onEvent) {
  const rootPath = normalized.paths[0];
  if (!rootPath) return failure("Path is required.");
  const info = await runtime.pathInfo(rootPath);
  if (!info.exists) return failure(`Path does not exist: ${rootPath}`);
  if (!info.isDirectory) return failure(`Path is not a directory: ${rootPath}`);
  onEvent({ type: "progress", progress: 10, message: "Planning single-pack operations." });
  const operations = await planSinglePackOperations(runtime.resolve(rootPath), runtime);
  const executed = await executeOperations(operations, runtime, normalized, onEvent);
  return {
    success: executed.failedCount === 0,
    message: normalized.dryRun ? `Single-pack plan complete: ${executed.plannedCount} operation(s).` : `Single-pack complete: ${executed.compressedCount} succeeded, ${executed.failedCount} failed.`,
    data: executed
  };
}
async function runGalleryPack(normalized, runtime, onEvent) {
  const rootPath = normalized.paths[0];
  if (!rootPath) return failure("Path is required.");
  const info = await runtime.pathInfo(rootPath);
  if (!info.exists) return failure(`Path does not exist: ${rootPath}`);
  if (!info.isDirectory) return failure(`Path is not a directory: ${rootPath}`);
  onEvent({ type: "progress", progress: 10, message: "Finding gallery folders." });
  const galleryFolders = await findGalleryFolders(runtime.resolve(rootPath), normalized.galleryMarker, runtime);
  const operations = [];
  for (const folder of galleryFolders) {
    operations.push(...await planSinglePackOperations(folder, runtime));
  }
  const executed = await executeOperations(operations, runtime, normalized, onEvent);
  return {
    success: executed.failedCount === 0,
    message: normalized.dryRun ? `Gallery-pack plan complete: ${galleryFolders.length} folder(s), ${executed.plannedCount} operation(s).` : `Gallery-pack complete: ${executed.compressedCount} succeeded, ${executed.failedCount} failed.`,
    data: { ...executed, galleryCount: galleryFolders.length }
  };
}
async function analyzeToConfig(rootPath, normalized, runtime, onEvent) {
  const resolved = runtime.resolve(rootPath);
  const info = await runtime.pathInfo(resolved);
  if (!info.exists) throw new Error(`Path does not exist: ${rootPath}`);
  if (!info.isDirectory) throw new Error(`Path is not a directory: ${rootPath}`);
  onEvent({ type: "progress", progress: 20, message: "Scanning folder tree." });
  const folderTree = await analyzeFolderStructure(resolved, runtime, {
    targetFileTypes: normalized.targetFileTypes,
    minCount: normalized.minCount
  });
  if (!folderTree) throw new Error("Folder could not be analyzed.");
  onEvent({ type: "progress", progress: 75, message: "Writing config." });
  const created = createRepackuConfig(resolved, folderTree, runtime, {
    targetFileTypes: normalized.targetFileTypes,
    minCount: normalized.minCount,
    outputPath: normalized.outputPath
  });
  await runtime.ensureDir(runtime.dirname(created.configPath));
  await runtime.writeText(created.configPath, serializeRepackuConfig(created.config));
  onEvent({ type: "progress", progress: 100, message: "Analysis complete." });
  return {
    configPath: created.configPath,
    config: created.config,
    stats: countCompressionModes(folderTree)
  };
}
async function executeConfig(config, runtime, normalized, onEvent) {
  const operations = collectCompressionOperations(config, runtime);
  return executeOperations(operations, runtime, normalized, onEvent);
}
async function executeOperations(operations, runtime, normalized, onEvent) {
  const completed = [];
  if (!operations.length) return emptyData({ operations: [], skippedCount: 0 });
  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index];
    onEvent({ type: "progress", progress: operationProgress(index, operations.length), message: `${operation.mode}: ${operation.sourcePath}` });
    if (operation.status === "skipped") {
      completed.push(operation);
      continue;
    }
    if (normalized.dryRun) {
      completed.push({ ...operation, status: "planned" });
      continue;
    }
    try {
      await runtime.ensureDir(runtime.dirname(operation.targetPath));
      const result = operation.mode === "entire" ? await runtime.compressWholeFolder(operation.sourcePath, operation.targetPath, { deleteSource: normalized.deleteAfter }) : await runtime.compressFiles(operation.sourcePath, operation.targetPath, operation.extensions, { deleteSource: normalized.deleteAfter });
      completed.push({
        ...operation,
        status: result.success ? "success" : "error",
        originalSize: result.originalSize,
        compressedSize: result.compressedSize,
        error: result.error,
        command: result.command
      });
    } catch (error) {
      completed.push({
        ...operation,
        status: "error",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  onEvent({ type: "progress", progress: 100, message: "Compression flow complete." });
  return emptyData({
    operations: completed,
    plannedCount: completed.filter((item) => item.status === "planned").length,
    compressedCount: completed.filter((item) => item.status === "success").length,
    failedCount: completed.filter((item) => item.status === "error").length,
    skippedCount: completed.filter((item) => item.status === "skipped").length,
    totalOperations: completed.length,
    errors: completed.filter((item) => item.status === "error").map((item) => `${item.sourcePath}: ${item.error ?? "unknown error"}`)
  });
}
async function analyzeNode(folderPath, parentPath, depth, runtime, options) {
  if (isBlacklistedPath(folderPath)) return null;
  const entries = await runtime.listDir(folderPath);
  const childEntries = entries.filter((entry) => entry.isDirectory).sort((a, b) => a.name.localeCompare(b.name, void 0, { numeric: true, sensitivity: "base" }));
  const children = [];
  for (const child of childEntries) {
    const childNode = await analyzeNode(child.path, folderPath, depth + 1, runtime, options);
    if (childNode) children.push(childNode);
  }
  const files = entries.filter((entry) => entry.isFile);
  const fileTypes = countFileTypes(files);
  const childBlocksEntire = children.some((child) => child.fileTypes.archive > 0 || child.compressMode === "skip");
  const decision = determineCompressMode(folderPath, files, fileTypes, options.targetFileTypes, childBlocksEntire, options.minCount);
  let compressMode = decision.mode;
  if (compressMode === "entire" && children.some((child) => child.compressMode !== "skip")) {
    compressMode = "selective";
  }
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  const recursiveSize = totalSize + children.reduce((sum, child) => sum + child.recursiveSize, 0);
  const node = {
    path: folderPath,
    name: runtime.basename(folderPath),
    parentPath,
    depth,
    weight: depth + recursiveSize / 1024 ** 3 * 0.1,
    totalFiles: files.length,
    totalSize,
    recursiveSize,
    sizeMb: totalSize / 1024 ** 2,
    compressMode,
    recommendation: recommendation(fileTypes, compressMode),
    fileTypes,
    fileExtensions: decision.extensions,
    dominantTypes: dominantTypes(fileTypes),
    children: children.sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name, void 0, { numeric: true, sensitivity: "base" }))
  };
  return node;
}
function determineCompressMode(folderPath, files, fileTypes, targetTypes, hasChildWithArchive, minCount) {
  if (!files.length || isBlacklistedPath(folderPath)) return { mode: "skip", extensions: {} };
  const hasArchive = (fileTypes.archive ?? 0) > 0;
  if (hasArchive || hasChildWithArchive) {
    if (!targetTypes.length) return { mode: "skip", extensions: {} };
    const matching2 = files.filter((file) => isFileInTypes(file.name, targetTypes));
    if (matching2.length >= minCount) return { mode: "selective", extensions: countExtensions(matching2) };
    return { mode: "skip", extensions: {} };
  }
  if (!targetTypes.length) {
    return files.length >= minCount ? { mode: "entire", extensions: countExtensions(files) } : { mode: "skip", extensions: {} };
  }
  const matching = files.filter((file) => isFileInTypes(file.name, targetTypes));
  if (matching.length < minCount) return { mode: "skip", extensions: countExtensions(matching) };
  if (matching.length === files.length) return { mode: "entire", extensions: countExtensions(matching) };
  if (targetTypes.includes("image") && allExtendedMedia(files)) return { mode: "entire", extensions: countExtensions(files) };
  return { mode: "selective", extensions: countExtensions(matching) };
}
async function planSinglePackOperations(rootPath, runtime) {
  const entries = await runtime.listDir(rootPath);
  const operations = [];
  for (const entry of selectSinglePackFolderSources(entries)) {
    if (await hasInternalArchive(entry.path, runtime)) {
      operations.push({
        mode: "entire",
        sourcePath: entry.path,
        targetPath: runtime.join(rootPath, `${entry.name}.zip`),
        extensions: [],
        fileCount: 0,
        status: "skipped",
        originalSize: 0,
        compressedSize: 0,
        error: "contains_archive"
      });
      continue;
    }
    operations.push({
      mode: "entire",
      sourcePath: entry.path,
      targetPath: runtime.join(rootPath, `${entry.name}.zip`),
      extensions: [],
      fileCount: 0,
      status: "planned",
      originalSize: 0,
      compressedSize: 0
    });
  }
  const looseImages = entries.filter((item) => item.isFile && isFileInTypes(item.name, ["image"]));
  if (looseImages.length) {
    operations.push({
      mode: "selective",
      sourcePath: rootPath,
      targetPath: runtime.join(rootPath, `${runtime.basename(rootPath)}.zip`),
      extensions: [...IMAGE_EXTENSIONS].sort(),
      fileCount: looseImages.length,
      status: "planned",
      originalSize: 0,
      compressedSize: 0
    });
  }
  return operations;
}
function selectSinglePackFolderSources(entries) {
  return entries.filter((entry) => entry.isDirectory).sort((left, right) => left.name.localeCompare(right.name, void 0, { numeric: true, sensitivity: "base" }));
}
async function hasInternalArchive(path, runtime) {
  for (const entry of await runtime.listDir(path)) {
    if (entry.isFile && isArchiveFile(entry.name)) return true;
    if (entry.isDirectory && await hasInternalArchive(entry.path, runtime)) return true;
  }
  return false;
}
async function findGalleryFolders(rootPath, marker, runtime) {
  const folders = [];
  async function walk(path) {
    const entries = await runtime.listDir(path);
    for (const entry of entries) {
      if (!entry.isDirectory) continue;
      if (entry.name.includes(marker)) folders.push(entry.path);
      await walk(entry.path);
    }
  }
  await walk(rootPath);
  return folders;
}
function countFileTypes(files) {
  const counts = {};
  for (const file of files) {
    const type = getFileType(file.name);
    if (type) counts[type] = (counts[type] ?? 0) + 1;
  }
  return counts;
}
function countExtensions(files) {
  const counts = {};
  for (const file of files) {
    const extension = getExtension(file.name);
    if (extension) counts[extension] = (counts[extension] ?? 0) + 1;
  }
  return counts;
}
function dominantTypes(fileTypes) {
  return Object.entries(fileTypes).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([type]) => type);
}
function recommendation(fileTypes, mode) {
  const dominant = dominantTypes(fileTypes).join(", ") || "none";
  if (mode === "entire") return `Compress whole folder; dominant types: ${dominant}.`;
  if (mode === "selective") return `Compress selected matching files; dominant types: ${dominant}.`;
  return `Skip or handle manually; dominant types: ${dominant}.`;
}
function allExtendedMedia(files) {
  let hasImage = false;
  for (const file of files) {
    const type = getFileType(file.name);
    if (type === "image") hasImage = true;
    if (type !== "image" && type !== "document" && type !== "text") return false;
  }
  return hasImage;
}
function normalizeFolderNode(value) {
  const record = asRecord(value);
  if (!record.path) return null;
  const children = Array.isArray(record.children) ? record.children.map(normalizeFolderNode).filter((item) => Boolean(item)) : [];
  return {
    path: stringValue(record.path),
    name: stringValue(record.name) || stringValue(record.path),
    parentPath: stringValue(record.parentPath ?? record.parent_path),
    depth: numberValue(record.depth, 0),
    weight: numberValue(record.weight, 0),
    totalFiles: numberValue(record.totalFiles ?? record.total_files, 0),
    totalSize: numberValue(record.totalSize ?? record.total_size, 0),
    recursiveSize: numberValue(record.recursiveSize ?? record.recursive_size ?? record.totalSize ?? record.total_size, 0),
    sizeMb: numberValue(record.sizeMb ?? record.size_mb, 0),
    compressMode: normalizeMode(record.compressMode ?? record.compress_mode),
    recommendation: stringValue(record.recommendation),
    fileTypes: numberRecord(record.fileTypes ?? record.file_types),
    fileExtensions: numberRecord(record.fileExtensions ?? record.file_extensions),
    dominantTypes: normalizeTypes(record.dominantTypes ?? record.dominant_types),
    children
  };
}
function normalizeMode(value) {
  return value === "entire" || value === "selective" ? value : "skip";
}
function normalizePaths(input) {
  return unique([
    ...input.paths ?? [],
    ...input.path ? [input.path] : [],
    ...(input.pathText ?? "").split(/[\r\n;]/)
  ].map(clean).filter(Boolean));
}
function normalizeTypes(value) {
  if (Array.isArray(value)) return unique(value.map((item) => clean(String(item))).filter(Boolean));
  if (typeof value === "string") return unique(value.split(/[,;\s]+/).map(clean).filter(Boolean));
  return [];
}
function dataFromAnalysis(bundle) {
  return emptyData({
    configPath: bundle.configPath,
    folderTree: bundle.config.folderTree,
    ...statsToCounts(bundle.stats)
  });
}
function statsToCounts(stats) {
  return {
    totalFolders: stats.total,
    entireCount: stats.entire,
    selectiveCount: stats.selective,
    skipCount: stats.skip
  };
}
function mergeData(base, next) {
  return {
    ...base,
    plannedCount: next.plannedCount,
    compressedCount: next.compressedCount,
    failedCount: next.failedCount,
    skippedCount: next.skippedCount,
    totalOperations: next.totalOperations,
    galleryCount: next.galleryCount,
    operations: next.operations,
    errors: next.errors
  };
}
function emptyData(partial = {}) {
  return {
    configPath: "",
    totalFolders: 0,
    entireCount: 0,
    selectiveCount: 0,
    skipCount: 0,
    plannedCount: 0,
    compressedCount: 0,
    failedCount: 0,
    skippedCount: 0,
    totalOperations: 0,
    galleryCount: 0,
    folderTree: null,
    operations: [],
    errors: [],
    ...partial
  };
}
function failure(message) {
  return { success: false, message, data: emptyData({ errors: [message], failedCount: 1 }) };
}
function visitFolders(node, visitor) {
  visitor(node);
  for (const child of node.children) visitFolders(child, visitor);
}
function wholeFolderArchivePath(folderPath, runtime) {
  return runtime.join(runtime.dirname(folderPath), `${runtime.basename(folderPath)}.zip`);
}
function operationProgress(index, total) {
  return Math.min(99, Math.max(20, 20 + Math.round(index / Math.max(total, 1) * 75)));
}
function getExtension(name) {
  const base = name.split(/[\\/]/).pop() ?? name;
  const index = base.lastIndexOf(".");
  return index > 0 ? base.slice(index).toLowerCase() : "";
}
function sumCounts(values) {
  return Object.values(values).reduce((sum, value) => sum + value, 0);
}
function asRecord(value) {
  return value && typeof value === "object" ? value : {};
}
function numberRecord(value) {
  const record = asRecord(value);
  const result = {};
  for (const [key, raw] of Object.entries(record)) {
    const valueNumber = Number(raw);
    if (Number.isFinite(valueNumber)) result[key] = valueNumber;
  }
  return result;
}
function numberValue(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function stringValue(value) {
  return typeof value === "string" ? value : "";
}
function clean(value = "") {
  return value.trim().replace(/^["']|["']$/g, "");
}
function unique(values) {
  const seen = /* @__PURE__ */ new Set();
  return values.filter((value) => {
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
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
var dirname = (path) => dirnameWith(path, native());
var basename = (path, suffix) => basenameWith(path, native(), suffix);
var extname = (path) => extnameWith(path, native());
var _makeLong = notImplemented("path", "_makeLong");

// packages/nodes/repacku/src/platform.ts
var SEVEN_ZIP_NAMES = ["7z", "7zz", "7za", "7z.exe", "7zz.exe", "7za.exe"];
function createNodeRepackuRuntime() {
  return {
    pathInfo,
    listDir,
    readText: (path) => readFile(path, "utf8"),
    writeText: (path, content) => writeFile(path, content, "utf8").then(() => void 0),
    ensureDir: (path) => mkdir(path, { recursive: true }).then(() => void 0),
    compressWholeFolder,
    compressFiles,
    join,
    dirname,
    basename,
    extname,
    resolve,
    now: () => /* @__PURE__ */ new Date()
  };
}
async function pathInfo(path) {
  const resolved = resolve(path);
  try {
    const item = await stat(resolved);
    return {
      path: resolved,
      exists: true,
      isFile: item.isFile(),
      isDirectory: item.isDirectory(),
      size: item.size
    };
  } catch {
    return { path: resolved, exists: false, isFile: false, isDirectory: false, size: 0 };
  }
}
async function listDir(path) {
  const resolved = resolve(path);
  const entries = await readdir(resolved, { withFileTypes: true });
  return Promise.all(entries.map(async (entry) => {
    const entryPath = join(resolved, entry.name);
    const item = await safeStat(entryPath);
    return {
      name: entry.name,
      path: entryPath,
      isFile: entry.isFile(),
      isDirectory: entry.isDirectory(),
      size: item?.isFile() ? item.size : 0
    };
  }));
}
async function compressWholeFolder(sourcePath, targetPath, options) {
  const resolvedSource = resolve(sourcePath);
  const resolvedTarget = resolve(targetPath);
  const source = await safeStat(resolvedSource);
  if (!source?.isDirectory()) return { success: false, originalSize: 0, compressedSize: 0, error: `Source is not a directory: ${sourcePath}` };
  const originalSize = await folderSize(resolvedSource);
  await mkdir(dirname(resolvedTarget), { recursive: true });
  const compressor = await findCompressor();
  if (!compressor) return { success: false, originalSize, compressedSize: 0, error: "No compressor found. Install 7-Zip or use Windows PowerShell Compress-Archive." };
  const result = compressor.kind === "7z" ? await run7zWithList(compressor.command, resolvedTarget, [basename(resolvedSource)], { cwd: dirname(resolvedSource), recursive: true }) : await runPowerShellCompressArchive(compressor.command, [resolvedSource], resolvedTarget);
  if (result.code !== 0) return { success: false, originalSize, compressedSize: 0, error: shortError(result), command: formatCommand(compressor.command, resultCommandArgs(result)) };
  const compressedSize = (await safeStat(resolvedTarget))?.size ?? 0;
  if (options.deleteSource) await rm(resolvedSource, { recursive: true, force: true });
  return {
    success: true,
    originalSize,
    compressedSize,
    command: compressor.kind
  };
}
async function compressFiles(sourcePath, targetPath, extensions, options) {
  const resolvedSource = resolve(sourcePath);
  const resolvedTarget = resolve(targetPath);
  const source = await safeStat(resolvedSource);
  if (!source?.isDirectory()) return { success: false, originalSize: 0, compressedSize: 0, error: `Source is not a directory: ${sourcePath}` };
  const files = await matchingDirectFiles(resolvedSource, extensions, resolvedTarget);
  if (!files.length) return { success: false, originalSize: 0, compressedSize: 0, error: "No matching files found." };
  const originalSize = files.reduce((sum, item) => sum + item.size, 0);
  await mkdir(dirname(resolvedTarget), { recursive: true });
  const compressor = await findCompressor();
  if (!compressor) return { success: false, originalSize, compressedSize: 0, error: "No compressor found. Install 7-Zip or use Windows PowerShell Compress-Archive." };
  const result = compressor.kind === "7z" ? await run7zWithList(compressor.command, resolvedTarget, files.map((file) => basename(file.path)), { cwd: resolvedSource }) : await runPowerShellCompressArchive(compressor.command, files.map((file) => file.path), resolvedTarget);
  if (result.code !== 0) return { success: false, originalSize, compressedSize: 0, error: shortError(result), command: compressor.kind };
  const compressedSize = (await safeStat(resolvedTarget))?.size ?? 0;
  if (options.deleteSource) {
    await Promise.all(files.map((file) => unlink(file.path).catch(() => void 0)));
  }
  return {
    success: true,
    originalSize,
    compressedSize,
    command: compressor.kind
  };
}
async function matchingDirectFiles(sourcePath, extensions, targetPath) {
  const normalizedExtensions = new Set(extensions.map((item) => item.toLowerCase()));
  const target = resolve(targetPath).toLowerCase();
  const entries = await readdir(sourcePath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const path = join(sourcePath, entry.name);
    if (resolve(path).toLowerCase() === target) continue;
    if (normalizedExtensions.size && !normalizedExtensions.has(extname(entry.name).toLowerCase())) continue;
    const item = await safeStat(path);
    if (item?.isFile()) files.push({ path, size: item.size });
  }
  return files;
}
async function findCompressor() {
  const env = process.env.REPACKU_7Z_PATH || process.env.SEVEN_ZIP_PATH || process.env["7ZIP_PATH"];
  if (env) {
    const fromEnv = await resolveCompressorPath(env);
    if (fromEnv) return { kind: "7z", command: fromEnv };
  }
  for (const name of SEVEN_ZIP_NAMES) {
    const fromPath = await findOnPath(name);
    if (fromPath) return { kind: "7z", command: fromPath };
  }
  if (process.platform === "win32") {
    const ps = await findOnPath("powershell.exe");
    if (ps) return { kind: "powershell", command: ps };
  }
  return null;
}
async function resolveCompressorPath(value) {
  const info = await safeStat(value);
  if (info?.isFile()) return value;
  if (info?.isDirectory()) {
    for (const name of SEVEN_ZIP_NAMES) {
      const candidate = join(value, name);
      const candidateInfo = await safeStat(candidate);
      if (candidateInfo?.isFile()) return candidate;
    }
  }
  return null;
}
async function findOnPath(command) {
  const locator = process.platform === "win32" ? "where.exe" : "which";
  const result = await runCommand(locator, [command]);
  if (result.code !== 0) return null;
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null;
}
async function run7z(command, args, options) {
  return runCommand(command, ["-sccUTF-8", "-scsUTF-8", ...args], options);
}
async function run7zWithList(command, targetPath, entries, options) {
  const dir = await mkdtemp(join(tmpdir(), "xiranite-repacku-"));
  const listPath = join(dir, "files.txt");
  try {
    await writeFile(listPath, `\uFEFF${entries.join("\n")}
`, "utf8");
    return await run7z(command, [
      "a",
      "-tzip",
      targetPath,
      `@${listPath}`,
      options.recursive ? "-r" : "",
      `-mx=${compressionLevel()}`,
      "-mmt=on",
      "-aou"
    ].filter(Boolean), { cwd: options.cwd });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
async function runPowerShellCompressArchive(command, literalPaths, targetPath) {
  const pathList = literalPaths.map(quotePowerShell).join(", ");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    `$paths = @(${pathList})`,
    `Compress-Archive -LiteralPath $paths -DestinationPath ${quotePowerShell(targetPath)} -Force`
  ].join("; ");
  return runCommand(command, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script]);
}
async function runCommand(command, args, options) {
  return new Promise((resolveResult) => {
    execFile(command, args, { cwd: options?.cwd, windowsHide: true, maxBuffer: 1024 * 1024 * 32, encoding: "buffer" }, (error, stdout, stderr) => {
      const code = typeof error?.code === "number" ? error.code : error ? 1 : 0;
      resolveResult({
        code,
        stdout: decodeProcessOutput(stdout),
        stderr: decodeProcessOutput(stderr) || (error instanceof Error ? error.message : "")
      });
    });
  });
}
async function safeStat(path) {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}
async function folderSize(path) {
  let total = 0;
  for (const entry of await listDir(path)) {
    if (entry.isFile) total += entry.size;
    else if (entry.isDirectory) total += await folderSize(entry.path);
  }
  return total;
}
function compressionLevel() {
  const parsed = Number(process.env.REPACKU_COMPRESSION_LEVEL ?? 7);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(9, Math.floor(parsed))) : 7;
}
function shortError(result) {
  const text = (result.stderr || result.stdout || `exit code ${result.code}`).trim();
  return text.length > 800 ? `...${text.slice(-797)}` : text;
}
function resultCommandArgs(_result) {
  return [];
}
function formatCommand(command, args) {
  return [command, ...args].map((part) => /\s/.test(part) ? `"${part.replace(/"/g, '\\"')}"` : part).join(" ");
}
function quotePowerShell(value) {
  return `'${value.replace(/'/g, "''")}'`;
}
function decodeProcessOutput(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(value);
  if (process.platform !== "win32" || !utf8.includes("\uFFFD")) return utf8;
  try {
    return new TextDecoder("gbk").decode(value);
  } catch {
    return utf8;
  }
}
export {
  createNodeRepackuRuntime,
  runRepacku
};
