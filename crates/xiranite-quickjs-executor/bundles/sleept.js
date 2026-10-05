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
var Buffer = class _Buffer extends Uint8Array {
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
  if (target.Buffer === void 0) target.Buffer = Buffer;
  if (realm.global === void 0) realm.global = realm;
  if (realm.crypto === void 0) realm.crypto = createCryptoGlobal();
}
installShimGlobals();

// packages/nodes/sleept/src/core.ts
var defaultSleeptInput = {
  action: "status",
  powerMode: "sleep",
  hours: 0,
  minutes: 0,
  seconds: 5,
  targetDatetime: void 0,
  uploadThreshold: 242,
  downloadThreshold: 242,
  netDuration: 2,
  netTriggerMode: "both",
  cpuThreshold: 10,
  cpuDuration: 2,
  dryrun: true,
  maxWaitSeconds: 3600
};
async function runSleept(rawInput, runtime, onEvent) {
  const input = normalizeInput(rawInput);
  if (input.action === "status") {
    return statusResult(await runtime.getCpuPercent());
  }
  if (input.action === "get_stats") {
    return getStats(runtime);
  }
  if (input.action === "countdown") {
    return runCountdown(input, runtime, onEvent);
  }
  if (input.action === "specific_time") {
    return runSpecificTime(input, runtime, onEvent);
  }
  if (input.action === "netspeed") {
    return runNetSpeedMonitor(input, runtime, onEvent);
  }
  if (input.action === "cpu") {
    return runCpuMonitor(input, runtime, onEvent);
  }
  return {
    success: false,
    message: `Unknown action: ${input.action}`,
    data: idleData()
  };
}
function normalizeInput(raw) {
  return {
    ...defaultSleeptInput,
    ...raw,
    action: raw.action ?? defaultSleeptInput.action,
    powerMode: raw.powerMode ?? defaultSleeptInput.powerMode,
    targetDatetime: raw.targetDatetime ?? "",
    maxWaitSeconds: Math.max(0, Math.trunc(raw.maxWaitSeconds ?? defaultSleeptInput.maxWaitSeconds))
  };
}
function countdownSeconds(input) {
  return Math.max(0, Math.trunc(input.hours ?? 0) * 3600 + Math.trunc(input.minutes ?? 0) * 60 + Math.trunc(input.seconds ?? 0));
}
function formatDuration(totalSeconds) {
  const safe = Math.max(0, Math.trunc(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor(safe % 3600 / 60);
  const seconds = safe % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
function parseTargetDatetime(value, now = /* @__PURE__ */ new Date()) {
  const normalized = value.trim().replace(" ", "T");
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid datetime. Use YYYY-MM-DD HH:MM:SS.");
  }
  if (parsed <= now) {
    throw new Error("Target datetime must be in the future.");
  }
  return parsed;
}
async function runCountdown(input, runtime, onEvent) {
  const totalSeconds = countdownSeconds(input);
  if (totalSeconds <= 0) {
    return { success: false, message: "Countdown duration must be greater than zero.", data: idleData() };
  }
  const target = new Date(runtime.now().getTime() + totalSeconds * 1e3);
  if (!await tickCountdown(totalSeconds, runtime, onEvent)) {
    return countdownCancelled("Countdown");
  }
  await runtime.executePowerAction(input.powerMode, input.dryrun);
  return {
    success: true,
    message: input.dryrun ? `[dryrun] Countdown completed; simulated ${input.powerMode}.` : `Countdown completed; executed ${input.powerMode}.`,
    data: {
      ...idleData(),
      timerStatus: "completed",
      targetTime: formatDatetime(target)
    }
  };
}
async function runSpecificTime(input, runtime, onEvent) {
  const target = parseTargetDatetime(input.targetDatetime, runtime.now());
  const totalSeconds = Math.ceil((target.getTime() - runtime.now().getTime()) / 1e3);
  if (!await tickCountdown(totalSeconds, runtime, onEvent)) {
    return countdownCancelled("Scheduled timer");
  }
  await runtime.executePowerAction(input.powerMode, input.dryrun);
  return {
    success: true,
    message: input.dryrun ? `[dryrun] Scheduled time reached; simulated ${input.powerMode}.` : `Scheduled time reached; executed ${input.powerMode}.`,
    data: {
      ...idleData(),
      timerStatus: "completed",
      targetTime: formatDatetime(target)
    }
  };
}
async function runNetSpeedMonitor(input, runtime, onEvent) {
  const durationSeconds = Math.max(1, input.netDuration * 60);
  let last = await runtime.getNetCounters();
  let lastTime = runtime.now().getTime();
  let lowStart = null;
  for (let elapsedTotal = 0; input.maxWaitSeconds === 0 || elapsedTotal < input.maxWaitSeconds; elapsedTotal += 1) {
    await runtime.waitWhilePaused?.();
    if (runtime.isCancelled?.()) return monitorCancelled("Network");
    await runtime.sleep(1e3);
    if (runtime.isCancelled?.()) return monitorCancelled("Network");
    const nowCounters = await runtime.getNetCounters();
    const nowTime = runtime.now().getTime();
    const intervalSeconds = Math.max(1e-3, (nowTime - lastTime) / 1e3);
    const upload = (nowCounters.bytesSent - last.bytesSent) / intervalSeconds / 1024;
    const download = (nowCounters.bytesReceived - last.bytesReceived) / intervalSeconds / 1024;
    const lowUp = upload < input.uploadThreshold;
    const lowDown = download < input.downloadThreshold;
    const triggered = input.netTriggerMode === "both" ? lowUp && lowDown : lowUp || lowDown;
    if (triggered) {
      lowStart ??= nowTime;
      const elapsed = (nowTime - lowStart) / 1e3;
      const progress = Math.min(99, Math.floor(elapsed / durationSeconds * 100));
      onEvent?.({ type: "progress", progress, message: `low network ${Math.floor(elapsed)}s/${Math.floor(durationSeconds)}s (up ${upload.toFixed(1)} down ${download.toFixed(1)} KB/s)` });
      if (elapsed >= durationSeconds) {
        await runtime.executePowerAction(input.powerMode, input.dryrun);
        return {
          success: true,
          message: input.dryrun ? `[dryrun] Network monitor triggered; simulated ${input.powerMode}.` : `Network monitor triggered; executed ${input.powerMode}.`,
          data: { ...idleData(), timerStatus: "completed", currentUpload: upload, currentDownload: download }
        };
      }
    } else {
      lowStart = null;
      onEvent?.({ type: "progress", progress: 0, message: `monitoring network (up ${upload.toFixed(1)} down ${download.toFixed(1)} KB/s)` });
    }
    last = nowCounters;
    lastTime = nowTime;
  }
  return { success: false, message: "Network monitor timed out.", data: { ...idleData(), timerStatus: "cancelled" } };
}
async function runCpuMonitor(input, runtime, onEvent) {
  const durationSeconds = Math.max(1, input.cpuDuration * 60);
  let lowStart = null;
  for (let elapsedTotal = 0; input.maxWaitSeconds === 0 || elapsedTotal < input.maxWaitSeconds; elapsedTotal += 1) {
    await runtime.waitWhilePaused?.();
    if (runtime.isCancelled?.()) return monitorCancelled("CPU");
    await runtime.sleep(1e3);
    if (runtime.isCancelled?.()) return monitorCancelled("CPU");
    const cpu = await runtime.getCpuPercent();
    const nowTime = runtime.now().getTime();
    if (cpu < input.cpuThreshold) {
      lowStart ??= nowTime;
      const elapsed = (nowTime - lowStart) / 1e3;
      const progress = Math.min(99, Math.floor(elapsed / durationSeconds * 100));
      onEvent?.({ type: "progress", progress, message: `low CPU ${cpu.toFixed(1)}% ${Math.floor(elapsed)}s/${Math.floor(durationSeconds)}s` });
      if (elapsed >= durationSeconds) {
        await runtime.executePowerAction(input.powerMode, input.dryrun);
        return {
          success: true,
          message: input.dryrun ? `[dryrun] CPU monitor triggered; simulated ${input.powerMode}.` : `CPU monitor triggered; executed ${input.powerMode}.`,
          data: { ...idleData(), timerStatus: "completed", currentCpu: cpu }
        };
      }
    } else {
      lowStart = null;
      onEvent?.({ type: "progress", progress: 0, message: `monitoring CPU ${cpu.toFixed(1)}%` });
    }
  }
  return { success: false, message: "CPU monitor timed out.", data: { ...idleData(), timerStatus: "cancelled" } };
}
function monitorCancelled(kind) {
  return {
    success: false,
    message: `${kind} monitor cancelled.`,
    data: { ...idleData(), timerStatus: "cancelled" }
  };
}
function countdownCancelled(kind) {
  return {
    success: false,
    message: `${kind} cancelled.`,
    data: { ...idleData(), timerStatus: "cancelled" }
  };
}
async function tickCountdown(totalSeconds, runtime, onEvent) {
  for (let remaining = totalSeconds; remaining > 0; remaining -= 1) {
    await runtime.waitWhilePaused?.();
    if (runtime.isCancelled?.()) return false;
    const progress = Math.floor((1 - remaining / totalSeconds) * 100);
    onEvent?.({ type: "progress", progress, message: `remaining ${formatDuration(remaining)}` });
    await runtime.sleep(1e3);
    if (runtime.isCancelled?.()) return false;
  }
  onEvent?.({ type: "progress", progress: 100, message: "time reached" });
  return true;
}
async function getStats(runtime) {
  const first = await runtime.getNetCounters();
  await runtime.sleep(500);
  const second = await runtime.getNetCounters();
  const cpu = await runtime.getCpuPercent();
  const upload = (second.bytesSent - first.bytesSent) / 0.5 / 1024;
  const download = (second.bytesReceived - first.bytesReceived) / 0.5 / 1024;
  return {
    success: true,
    message: `CPU: ${cpu.toFixed(1)}%, upload: ${upload.toFixed(1)}KB/s, download: ${download.toFixed(1)}KB/s`,
    data: { ...idleData(), currentCpu: cpu, currentUpload: upload, currentDownload: download }
  };
}
function statusResult(cpu) {
  return {
    success: true,
    message: "Status ready.",
    data: { ...idleData(), currentCpu: cpu }
  };
}
function idleData() {
  return {
    timerStatus: "idle",
    remainingSeconds: 0,
    currentUpload: 0,
    currentDownload: 0,
    currentCpu: 0
  };
}
function formatDatetime(value) {
  const yyyy = value.getFullYear();
  const mm = String(value.getMonth() + 1).padStart(2, "0");
  const dd = String(value.getDate()).padStart(2, "0");
  const hh = String(value.getHours()).padStart(2, "0");
  const mi = String(value.getMinutes()).padStart(2, "0");
  const ss = String(value.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
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

// packages/quickjs-shims/src/util.ts
var customPromisifyArgs2 = /* @__PURE__ */ Symbol.for("nodejs.util.promisify.custom_args");
var promisifyCustom = /* @__PURE__ */ Symbol.for("nodejs.util.promisify.custom");
function promisify(original) {
  if (typeof original !== "function") throw new TypeError(`The 'original' argument must be a function. Received type ${typeof original}`);
  const custom = original[promisifyCustom];
  if (typeof custom === "function") return custom;
  const argumentNames = original[customPromisifyArgs2] ?? ["value"];
  return function promisified(...args) {
    return new Promise((resolve, reject) => {
      original.call(
        this,
        ...args,
        ((error, ...values) => {
          if (error) {
            reject(error);
            return;
          }
          if (argumentNames.length <= 1) {
            resolve(values[0]);
            return;
          }
          const result = {};
          for (const [index, name] of argumentNames.entries()) result[name] = values[index];
          resolve(result);
        })
      );
    });
  };
}
var parseArgs = notImplemented("util", "parseArgs");
var TextEncoder = notImplemented("util", "TextEncoder", "the executor enables quickjs-wpt-sys for the global TextEncoder");
var TextDecoder = notImplemented("util", "TextDecoder", "the executor enables quickjs-wpt-sys for the global TextDecoder");

// packages/quickjs-shims/src/os.ts
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

// packages/nodes/sleept/src/platform.ts
var execFileAsync = promisify(execFile);
var lastCpuSample = readCpuSample();
function createNodeSleeptRuntime() {
  return {
    now: () => /* @__PURE__ */ new Date(),
    sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    getCpuPercent: () => getCpuPercent(),
    getNetCounters: () => getNetCounters(),
    executePowerAction: (mode, dryrun) => executePowerAction(mode, dryrun)
  };
}
async function getCpuPercent() {
  const current = readCpuSample();
  const idle = current.idle - lastCpuSample.idle;
  const total = current.total - lastCpuSample.total;
  lastCpuSample = current;
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, 100 - idle / total * 100));
}
async function getNetCounters() {
  const platform = process.platform;
  if (platform === "win32") {
    try {
      const { stdout } = await execFileAsync("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "$ProgressPreference = 'SilentlyContinue'; Get-NetAdapterStatistics | ConvertTo-Json -Compress"
      ]);
      const parsed = JSON.parse(stdout.trim() || "[]");
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      return rows.reduce(
        (acc, row) => ({
          bytesSent: acc.bytesSent + Number(row.SentBytes ?? 0),
          bytesReceived: acc.bytesReceived + Number(row.ReceivedBytes ?? 0)
        }),
        { bytesSent: 0, bytesReceived: 0 }
      );
    } catch {
      return { bytesSent: 0, bytesReceived: 0 };
    }
  }
  return { bytesSent: 0, bytesReceived: 0 };
}
async function executePowerAction(mode, dryrun) {
  if (dryrun) return;
  const command = resolvePowerCommand(process.platform, mode);
  if (!command) throw new Error(`Hibernate is not supported by the ${process.platform} Sleept adapter.`);
  await execFileAsync(command.executable, command.args);
}
function resolvePowerCommand(platform, mode) {
  if (platform === "win32") {
    if (mode === "sleep") return { executable: "rundll32.exe", args: ["powrprof.dll,SetSuspendState", "0,1,0"] };
    if (mode === "hibernate") return { executable: "shutdown", args: ["/h"] };
    if (mode === "shutdown") return { executable: "shutdown", args: ["/s", "/t", "1"] };
    return { executable: "shutdown", args: ["/r", "/t", "1"] };
  }
  if (platform === "darwin") {
    if (mode === "hibernate") return void 0;
    if (mode === "sleep") return { executable: "pmset", args: ["sleepnow"] };
    return { executable: "osascript", args: ["-e", `tell app "System Events" to ${mode === "shutdown" ? "shut down" : "restart"}`] };
  }
  if (mode === "sleep") return { executable: "systemctl", args: ["suspend"] };
  if (mode === "hibernate") return { executable: "systemctl", args: ["hibernate"] };
  if (mode === "shutdown") return { executable: "systemctl", args: ["poweroff"] };
  return { executable: "systemctl", args: ["reboot"] };
}
function readCpuSample() {
  return cpus().reduce(
    (acc, cpu) => {
      const times = cpu.times;
      const total = times.user + times.nice + times.sys + times.idle + times.irq;
      return { idle: acc.idle + times.idle, total: acc.total + total };
    },
    { idle: 0, total: 0 }
  );
}
export {
  createNodeSleeptRuntime,
  runSleept
};
