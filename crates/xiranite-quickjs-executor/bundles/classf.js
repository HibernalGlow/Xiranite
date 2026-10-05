var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/base64-js/index.js
var require_base64_js = __commonJS({
  "node_modules/base64-js/index.js"(exports) {
    "use strict";
    init_src();
    exports.byteLength = byteLength;
    exports.toByteArray = toByteArray;
    exports.fromByteArray = fromByteArray;
    var lookup = [];
    var revLookup = [];
    var Arr = typeof Uint8Array !== "undefined" ? Uint8Array : Array;
    var code = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    for (i2 = 0, len = code.length; i2 < len; ++i2) {
      lookup[i2] = code[i2];
      revLookup[code.charCodeAt(i2)] = i2;
    }
    var i2;
    var len;
    revLookup["-".charCodeAt(0)] = 62;
    revLookup["_".charCodeAt(0)] = 63;
    function getLens(b64) {
      var len2 = b64.length;
      if (len2 % 4 > 0) {
        throw new Error("Invalid string. Length must be a multiple of 4");
      }
      var validLen = b64.indexOf("=");
      if (validLen === -1) validLen = len2;
      var placeHoldersLen = validLen === len2 ? 0 : 4 - validLen % 4;
      return [validLen, placeHoldersLen];
    }
    function byteLength(b64) {
      var lens = getLens(b64);
      var validLen = lens[0];
      var placeHoldersLen = lens[1];
      return (validLen + placeHoldersLen) * 3 / 4 - placeHoldersLen;
    }
    function _byteLength(b64, validLen, placeHoldersLen) {
      return (validLen + placeHoldersLen) * 3 / 4 - placeHoldersLen;
    }
    function toByteArray(b64) {
      var tmp;
      var lens = getLens(b64);
      var validLen = lens[0];
      var placeHoldersLen = lens[1];
      var arr = new Arr(_byteLength(b64, validLen, placeHoldersLen));
      var curByte = 0;
      var len2 = placeHoldersLen > 0 ? validLen - 4 : validLen;
      var i3;
      for (i3 = 0; i3 < len2; i3 += 4) {
        tmp = revLookup[b64.charCodeAt(i3)] << 18 | revLookup[b64.charCodeAt(i3 + 1)] << 12 | revLookup[b64.charCodeAt(i3 + 2)] << 6 | revLookup[b64.charCodeAt(i3 + 3)];
        arr[curByte++] = tmp >> 16 & 255;
        arr[curByte++] = tmp >> 8 & 255;
        arr[curByte++] = tmp & 255;
      }
      if (placeHoldersLen === 2) {
        tmp = revLookup[b64.charCodeAt(i3)] << 2 | revLookup[b64.charCodeAt(i3 + 1)] >> 4;
        arr[curByte++] = tmp & 255;
      }
      if (placeHoldersLen === 1) {
        tmp = revLookup[b64.charCodeAt(i3)] << 10 | revLookup[b64.charCodeAt(i3 + 1)] << 4 | revLookup[b64.charCodeAt(i3 + 2)] >> 2;
        arr[curByte++] = tmp >> 8 & 255;
        arr[curByte++] = tmp & 255;
      }
      return arr;
    }
    function tripletToBase64(num) {
      return lookup[num >> 18 & 63] + lookup[num >> 12 & 63] + lookup[num >> 6 & 63] + lookup[num & 63];
    }
    function encodeChunk(uint8, start, end) {
      var tmp;
      var output = [];
      for (var i3 = start; i3 < end; i3 += 3) {
        tmp = (uint8[i3] << 16 & 16711680) + (uint8[i3 + 1] << 8 & 65280) + (uint8[i3 + 2] & 255);
        output.push(tripletToBase64(tmp));
      }
      return output.join("");
    }
    function fromByteArray(uint8) {
      var tmp;
      var len2 = uint8.length;
      var extraBytes = len2 % 3;
      var parts = [];
      var maxChunkLength = 16383;
      for (var i3 = 0, len22 = len2 - extraBytes; i3 < len22; i3 += maxChunkLength) {
        parts.push(encodeChunk(uint8, i3, i3 + maxChunkLength > len22 ? len22 : i3 + maxChunkLength));
      }
      if (extraBytes === 1) {
        tmp = uint8[len2 - 1];
        parts.push(
          lookup[tmp >> 2] + lookup[tmp << 4 & 63] + "=="
        );
      } else if (extraBytes === 2) {
        tmp = (uint8[len2 - 2] << 8) + uint8[len2 - 1];
        parts.push(
          lookup[tmp >> 10] + lookup[tmp >> 4 & 63] + lookup[tmp << 2 & 63] + "="
        );
      }
      return parts.join("");
    }
  }
});

// node_modules/ieee754/index.js
var require_ieee754 = __commonJS({
  "node_modules/ieee754/index.js"(exports) {
    init_src();
    exports.read = function(buffer, offset, isLE, mLen, nBytes) {
      var e2, m2;
      var eLen = nBytes * 8 - mLen - 1;
      var eMax = (1 << eLen) - 1;
      var eBias = eMax >> 1;
      var nBits = -7;
      var i2 = isLE ? nBytes - 1 : 0;
      var d2 = isLE ? -1 : 1;
      var s2 = buffer[offset + i2];
      i2 += d2;
      e2 = s2 & (1 << -nBits) - 1;
      s2 >>= -nBits;
      nBits += eLen;
      for (; nBits > 0; e2 = e2 * 256 + buffer[offset + i2], i2 += d2, nBits -= 8) {
      }
      m2 = e2 & (1 << -nBits) - 1;
      e2 >>= -nBits;
      nBits += mLen;
      for (; nBits > 0; m2 = m2 * 256 + buffer[offset + i2], i2 += d2, nBits -= 8) {
      }
      if (e2 === 0) {
        e2 = 1 - eBias;
      } else if (e2 === eMax) {
        return m2 ? NaN : (s2 ? -1 : 1) * Infinity;
      } else {
        m2 = m2 + Math.pow(2, mLen);
        e2 = e2 - eBias;
      }
      return (s2 ? -1 : 1) * m2 * Math.pow(2, e2 - mLen);
    };
    exports.write = function(buffer, value, offset, isLE, mLen, nBytes) {
      var e2, m2, c2;
      var eLen = nBytes * 8 - mLen - 1;
      var eMax = (1 << eLen) - 1;
      var eBias = eMax >> 1;
      var rt = mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0;
      var i2 = isLE ? 0 : nBytes - 1;
      var d2 = isLE ? 1 : -1;
      var s2 = value < 0 || value === 0 && 1 / value < 0 ? 1 : 0;
      value = Math.abs(value);
      if (isNaN(value) || value === Infinity) {
        m2 = isNaN(value) ? 1 : 0;
        e2 = eMax;
      } else {
        e2 = Math.floor(Math.log(value) / Math.LN2);
        if (value * (c2 = Math.pow(2, -e2)) < 1) {
          e2--;
          c2 *= 2;
        }
        if (e2 + eBias >= 1) {
          value += rt / c2;
        } else {
          value += rt * Math.pow(2, 1 - eBias);
        }
        if (value * c2 >= 2) {
          e2++;
          c2 /= 2;
        }
        if (e2 + eBias >= eMax) {
          m2 = 0;
          e2 = eMax;
        } else if (e2 + eBias >= 1) {
          m2 = (value * c2 - 1) * Math.pow(2, mLen);
          e2 = e2 + eBias;
        } else {
          m2 = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen);
          e2 = 0;
        }
      }
      for (; mLen >= 8; buffer[offset + i2] = m2 & 255, i2 += d2, m2 /= 256, mLen -= 8) {
      }
      e2 = e2 << mLen | m2;
      eLen += mLen;
      for (; eLen > 0; buffer[offset + i2] = e2 & 255, i2 += d2, e2 /= 256, eLen -= 8) {
      }
      buffer[offset + i2 - d2] |= s2 * 128;
    };
  }
});

// node_modules/node-buffer/index.js
var require_node_buffer = __commonJS({
  "node_modules/node-buffer/index.js"(exports) {
    "use strict";
    init_src();
    var base64 = require_base64_js();
    var ieee754 = require_ieee754();
    var customInspectSymbol = typeof Symbol === "function" && typeof Symbol["for"] === "function" ? Symbol["for"]("nodejs.util.inspect.custom") : null;
    exports.Buffer = Buffer3;
    exports.SlowBuffer = SlowBuffer2;
    exports.INSPECT_MAX_BYTES = 50;
    var K_MAX_LENGTH = 2147483647;
    exports.kMaxLength = K_MAX_LENGTH;
    Buffer3.TYPED_ARRAY_SUPPORT = typedArraySupport();
    if (!Buffer3.TYPED_ARRAY_SUPPORT && typeof console !== "undefined" && typeof console.error === "function") {
      console.error(
        "This browser lacks typed array (Uint8Array) support which is required by `buffer` v5.x. Use `buffer` v4.x if you require old browser support."
      );
    }
    function typedArraySupport() {
      try {
        const arr = new Uint8Array(1);
        const proto = { foo: function() {
          return 42;
        } };
        Object.setPrototypeOf(proto, Uint8Array.prototype);
        Object.setPrototypeOf(arr, proto);
        return arr.foo() === 42;
      } catch (e2) {
        return false;
      }
    }
    Object.defineProperty(Buffer3.prototype, "parent", {
      enumerable: true,
      get: function() {
        if (!Buffer3.isBuffer(this)) return void 0;
        return this.buffer;
      }
    });
    Object.defineProperty(Buffer3.prototype, "offset", {
      enumerable: true,
      get: function() {
        if (!Buffer3.isBuffer(this)) return void 0;
        return this.byteOffset;
      }
    });
    function createBuffer(length) {
      if (length > K_MAX_LENGTH) {
        throw new RangeError('The value "' + length + '" is invalid for option "size"');
      }
      const buf = new Uint8Array(length);
      Object.setPrototypeOf(buf, Buffer3.prototype);
      return buf;
    }
    function Buffer3(arg, encodingOrOffset, length) {
      if (typeof arg === "number") {
        if (typeof encodingOrOffset === "string") {
          throw new TypeError(
            'The "string" argument must be of type string. Received type number'
          );
        }
        return allocUnsafe(arg);
      }
      return from(arg, encodingOrOffset, length);
    }
    Buffer3.poolSize = 8192;
    function from(value, encodingOrOffset, length) {
      if (typeof value === "string") {
        return fromString(value, encodingOrOffset);
      }
      if (ArrayBuffer.isView(value)) {
        return fromArrayView(value);
      }
      if (value == null) {
        throw new TypeError(
          "The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object. Received type " + typeof value
        );
      }
      if (isInstance(value, ArrayBuffer) || value && isInstance(value.buffer, ArrayBuffer)) {
        return fromArrayBuffer(value, encodingOrOffset, length);
      }
      if (typeof SharedArrayBuffer !== "undefined" && (isInstance(value, SharedArrayBuffer) || value && isInstance(value.buffer, SharedArrayBuffer))) {
        return fromArrayBuffer(value, encodingOrOffset, length);
      }
      if (typeof value === "number") {
        throw new TypeError(
          'The "value" argument must not be of type number. Received type number'
        );
      }
      const valueOf = value.valueOf && value.valueOf();
      if (valueOf != null && valueOf !== value) {
        return Buffer3.from(valueOf, encodingOrOffset, length);
      }
      const b2 = fromObject(value);
      if (b2) return b2;
      if (typeof Symbol !== "undefined" && Symbol.toPrimitive != null && typeof value[Symbol.toPrimitive] === "function") {
        return Buffer3.from(value[Symbol.toPrimitive]("string"), encodingOrOffset, length);
      }
      throw new TypeError(
        "The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object. Received type " + typeof value
      );
    }
    Buffer3.from = function(value, encodingOrOffset, length) {
      return from(value, encodingOrOffset, length);
    };
    Object.setPrototypeOf(Buffer3.prototype, Uint8Array.prototype);
    Object.setPrototypeOf(Buffer3, Uint8Array);
    function assertSize(size) {
      if (typeof size !== "number") {
        throw new TypeError('"size" argument must be of type number');
      } else if (size < 0) {
        throw new RangeError('The value "' + size + '" is invalid for option "size"');
      }
    }
    function alloc(size, fill, encoding) {
      assertSize(size);
      if (size <= 0) {
        return createBuffer(size);
      }
      if (fill !== void 0) {
        return typeof encoding === "string" ? createBuffer(size).fill(fill, encoding) : createBuffer(size).fill(fill);
      }
      return createBuffer(size);
    }
    Buffer3.alloc = function(size, fill, encoding) {
      return alloc(size, fill, encoding);
    };
    function allocUnsafe(size) {
      assertSize(size);
      return createBuffer(size < 0 ? 0 : checked(size) | 0);
    }
    Buffer3.allocUnsafe = function(size) {
      return allocUnsafe(size);
    };
    Buffer3.allocUnsafeSlow = function(size) {
      return allocUnsafe(size);
    };
    function fromString(string, encoding) {
      if (typeof encoding !== "string" || encoding === "") {
        encoding = "utf8";
      }
      if (!Buffer3.isEncoding(encoding)) {
        throw new TypeError("Unknown encoding: " + encoding);
      }
      const length = byteLength(string, encoding) | 0;
      let buf = createBuffer(length);
      const actual = buf.write(string, encoding);
      if (actual !== length) {
        buf = buf.slice(0, actual);
      }
      return buf;
    }
    function fromArrayLike(array) {
      const length = array.length < 0 ? 0 : checked(array.length) | 0;
      const buf = createBuffer(length);
      for (let i2 = 0; i2 < length; i2 += 1) {
        buf[i2] = array[i2] & 255;
      }
      return buf;
    }
    function fromArrayView(arrayView) {
      if (isInstance(arrayView, Uint8Array)) {
        const copy = new Uint8Array(arrayView);
        return fromArrayBuffer(copy.buffer, copy.byteOffset, copy.byteLength);
      }
      return fromArrayLike(arrayView);
    }
    function fromArrayBuffer(array, byteOffset, length) {
      if (byteOffset < 0 || array.byteLength < byteOffset) {
        throw new RangeError('"offset" is outside of buffer bounds');
      }
      if (array.byteLength < byteOffset + (length || 0)) {
        throw new RangeError('"length" is outside of buffer bounds');
      }
      let buf;
      if (byteOffset === void 0 && length === void 0) {
        buf = new Uint8Array(array);
      } else if (length === void 0) {
        buf = new Uint8Array(array, byteOffset);
      } else {
        buf = new Uint8Array(array, byteOffset, length);
      }
      Object.setPrototypeOf(buf, Buffer3.prototype);
      return buf;
    }
    function fromObject(obj) {
      if (Buffer3.isBuffer(obj)) {
        const len = checked(obj.length) | 0;
        const buf = createBuffer(len);
        if (buf.length === 0) {
          return buf;
        }
        obj.copy(buf, 0, 0, len);
        return buf;
      }
      if (obj.length !== void 0) {
        if (typeof obj.length !== "number" || numberIsNaN(obj.length)) {
          return createBuffer(0);
        }
        return fromArrayLike(obj);
      }
      if (obj.type === "Buffer" && Array.isArray(obj.data)) {
        return fromArrayLike(obj.data);
      }
    }
    function checked(length) {
      if (length >= K_MAX_LENGTH) {
        throw new RangeError("Attempt to allocate Buffer larger than maximum size: 0x" + K_MAX_LENGTH.toString(16) + " bytes");
      }
      return length | 0;
    }
    function SlowBuffer2(length) {
      if (+length != length) {
        length = 0;
      }
      return Buffer3.alloc(+length);
    }
    Buffer3.isBuffer = function isBuffer(b2) {
      return b2 != null && b2._isBuffer === true && b2 !== Buffer3.prototype;
    };
    Buffer3.compare = function compare(a2, b2) {
      if (isInstance(a2, Uint8Array)) a2 = Buffer3.from(a2, a2.offset, a2.byteLength);
      if (isInstance(b2, Uint8Array)) b2 = Buffer3.from(b2, b2.offset, b2.byteLength);
      if (!Buffer3.isBuffer(a2) || !Buffer3.isBuffer(b2)) {
        throw new TypeError(
          'The "buf1", "buf2" arguments must be one of type Buffer or Uint8Array'
        );
      }
      if (a2 === b2) return 0;
      let x = a2.length;
      let y2 = b2.length;
      for (let i2 = 0, len = Math.min(x, y2); i2 < len; ++i2) {
        if (a2[i2] !== b2[i2]) {
          x = a2[i2];
          y2 = b2[i2];
          break;
        }
      }
      if (x < y2) return -1;
      if (y2 < x) return 1;
      return 0;
    };
    Buffer3.isEncoding = function isEncoding(encoding) {
      switch (String(encoding).toLowerCase()) {
        case "hex":
        case "utf8":
        case "utf-8":
        case "ascii":
        case "latin1":
        case "binary":
        case "base64":
        case "ucs2":
        case "ucs-2":
        case "utf16le":
        case "utf-16le":
          return true;
        default:
          return false;
      }
    };
    Buffer3.concat = function concat(list, length) {
      if (!Array.isArray(list)) {
        throw new TypeError('"list" argument must be an Array of Buffers');
      }
      if (list.length === 0) {
        return Buffer3.alloc(0);
      }
      let i2;
      if (length === void 0) {
        length = 0;
        for (i2 = 0; i2 < list.length; ++i2) {
          length += list[i2].length;
        }
      }
      const buffer = Buffer3.allocUnsafe(length);
      let pos = 0;
      for (i2 = 0; i2 < list.length; ++i2) {
        let buf = list[i2];
        if (isInstance(buf, Uint8Array)) {
          if (pos + buf.length > buffer.length) {
            if (!Buffer3.isBuffer(buf)) buf = Buffer3.from(buf);
            buf.copy(buffer, pos);
          } else {
            Uint8Array.prototype.set.call(
              buffer,
              buf,
              pos
            );
          }
        } else if (!Buffer3.isBuffer(buf)) {
          throw new TypeError('"list" argument must be an Array of Buffers');
        } else {
          buf.copy(buffer, pos);
        }
        pos += buf.length;
      }
      return buffer;
    };
    function byteLength(string, encoding) {
      if (Buffer3.isBuffer(string)) {
        return string.length;
      }
      if (ArrayBuffer.isView(string) || isInstance(string, ArrayBuffer)) {
        return string.byteLength;
      }
      if (typeof string !== "string") {
        throw new TypeError(
          'The "string" argument must be one of type string, Buffer, or ArrayBuffer. Received type ' + typeof string
        );
      }
      const len = string.length;
      const mustMatch = arguments.length > 2 && arguments[2] === true;
      if (!mustMatch && len === 0) return 0;
      let loweredCase = false;
      for (; ; ) {
        switch (encoding) {
          case "ascii":
          case "latin1":
          case "binary":
            return len;
          case "utf8":
          case "utf-8":
            return utf8ToBytes(string).length;
          case "ucs2":
          case "ucs-2":
          case "utf16le":
          case "utf-16le":
            return len * 2;
          case "hex":
            return len >>> 1;
          case "base64":
            return base64ToBytes2(string).length;
          default:
            if (loweredCase) {
              return mustMatch ? -1 : utf8ToBytes(string).length;
            }
            encoding = ("" + encoding).toLowerCase();
            loweredCase = true;
        }
      }
    }
    Buffer3.byteLength = byteLength;
    function slowToString(encoding, start, end) {
      let loweredCase = false;
      if (start === void 0 || start < 0) {
        start = 0;
      }
      if (start > this.length) {
        return "";
      }
      if (end === void 0 || end > this.length) {
        end = this.length;
      }
      if (end <= 0) {
        return "";
      }
      end >>>= 0;
      start >>>= 0;
      if (end <= start) {
        return "";
      }
      if (!encoding) encoding = "utf8";
      while (true) {
        switch (encoding) {
          case "hex":
            return hexSlice(this, start, end);
          case "utf8":
          case "utf-8":
            return utf8Slice(this, start, end);
          case "ascii":
            return asciiSlice(this, start, end);
          case "latin1":
          case "binary":
            return latin1Slice(this, start, end);
          case "base64":
            return base64Slice(this, start, end);
          case "ucs2":
          case "ucs-2":
          case "utf16le":
          case "utf-16le":
            return utf16leSlice(this, start, end);
          default:
            if (loweredCase) throw new TypeError("Unknown encoding: " + encoding);
            encoding = (encoding + "").toLowerCase();
            loweredCase = true;
        }
      }
    }
    Buffer3.prototype._isBuffer = true;
    function swap(b2, n2, m2) {
      const i2 = b2[n2];
      b2[n2] = b2[m2];
      b2[m2] = i2;
    }
    Buffer3.prototype.swap16 = function swap16() {
      const len = this.length;
      if (len % 2 !== 0) {
        throw new RangeError("Buffer size must be a multiple of 16-bits");
      }
      for (let i2 = 0; i2 < len; i2 += 2) {
        swap(this, i2, i2 + 1);
      }
      return this;
    };
    Buffer3.prototype.swap32 = function swap32() {
      const len = this.length;
      if (len % 4 !== 0) {
        throw new RangeError("Buffer size must be a multiple of 32-bits");
      }
      for (let i2 = 0; i2 < len; i2 += 4) {
        swap(this, i2, i2 + 3);
        swap(this, i2 + 1, i2 + 2);
      }
      return this;
    };
    Buffer3.prototype.swap64 = function swap64() {
      const len = this.length;
      if (len % 8 !== 0) {
        throw new RangeError("Buffer size must be a multiple of 64-bits");
      }
      for (let i2 = 0; i2 < len; i2 += 8) {
        swap(this, i2, i2 + 7);
        swap(this, i2 + 1, i2 + 6);
        swap(this, i2 + 2, i2 + 5);
        swap(this, i2 + 3, i2 + 4);
      }
      return this;
    };
    Buffer3.prototype.toString = function toString() {
      const length = this.length;
      if (length === 0) return "";
      if (arguments.length === 0) return utf8Slice(this, 0, length);
      return slowToString.apply(this, arguments);
    };
    Buffer3.prototype.toLocaleString = Buffer3.prototype.toString;
    Buffer3.prototype.equals = function equals(b2) {
      if (!Buffer3.isBuffer(b2)) throw new TypeError("Argument must be a Buffer");
      if (this === b2) return true;
      return Buffer3.compare(this, b2) === 0;
    };
    Buffer3.prototype.inspect = function inspect() {
      let str = "";
      const max = exports.INSPECT_MAX_BYTES;
      str = this.toString("hex", 0, max).replace(/(.{2})/g, "$1 ").trim();
      if (this.length > max) str += " ... ";
      return "<Buffer " + str + ">";
    };
    if (customInspectSymbol) {
      Buffer3.prototype[customInspectSymbol] = Buffer3.prototype.inspect;
    }
    Buffer3.prototype.compare = function compare(target, start, end, thisStart, thisEnd) {
      if (isInstance(target, Uint8Array)) {
        target = Buffer3.from(target, target.offset, target.byteLength);
      }
      if (!Buffer3.isBuffer(target)) {
        throw new TypeError(
          'The "target" argument must be one of type Buffer or Uint8Array. Received type ' + typeof target
        );
      }
      if (start === void 0) {
        start = 0;
      }
      if (end === void 0) {
        end = target ? target.length : 0;
      }
      if (thisStart === void 0) {
        thisStart = 0;
      }
      if (thisEnd === void 0) {
        thisEnd = this.length;
      }
      if (start < 0 || end > target.length || thisStart < 0 || thisEnd > this.length) {
        throw new RangeError("out of range index");
      }
      if (thisStart >= thisEnd && start >= end) {
        return 0;
      }
      if (thisStart >= thisEnd) {
        return -1;
      }
      if (start >= end) {
        return 1;
      }
      start >>>= 0;
      end >>>= 0;
      thisStart >>>= 0;
      thisEnd >>>= 0;
      if (this === target) return 0;
      let x = thisEnd - thisStart;
      let y2 = end - start;
      const len = Math.min(x, y2);
      const thisCopy = this.slice(thisStart, thisEnd);
      const targetCopy = target.slice(start, end);
      for (let i2 = 0; i2 < len; ++i2) {
        if (thisCopy[i2] !== targetCopy[i2]) {
          x = thisCopy[i2];
          y2 = targetCopy[i2];
          break;
        }
      }
      if (x < y2) return -1;
      if (y2 < x) return 1;
      return 0;
    };
    function bidirectionalIndexOf(buffer, val, byteOffset, encoding, dir) {
      if (buffer.length === 0) return -1;
      if (typeof byteOffset === "string") {
        encoding = byteOffset;
        byteOffset = 0;
      } else if (byteOffset > 2147483647) {
        byteOffset = 2147483647;
      } else if (byteOffset < -2147483648) {
        byteOffset = -2147483648;
      }
      byteOffset = +byteOffset;
      if (numberIsNaN(byteOffset)) {
        byteOffset = dir ? 0 : buffer.length - 1;
      }
      if (byteOffset < 0) byteOffset = buffer.length + byteOffset;
      if (byteOffset >= buffer.length) {
        if (dir) return -1;
        else byteOffset = buffer.length - 1;
      } else if (byteOffset < 0) {
        if (dir) byteOffset = 0;
        else return -1;
      }
      if (typeof val === "string") {
        val = Buffer3.from(val, encoding);
      }
      if (Buffer3.isBuffer(val)) {
        if (val.length === 0) {
          return -1;
        }
        return arrayIndexOf(buffer, val, byteOffset, encoding, dir);
      } else if (typeof val === "number") {
        val = val & 255;
        if (typeof Uint8Array.prototype.indexOf === "function") {
          if (dir) {
            return Uint8Array.prototype.indexOf.call(buffer, val, byteOffset);
          } else {
            return Uint8Array.prototype.lastIndexOf.call(buffer, val, byteOffset);
          }
        }
        return arrayIndexOf(buffer, [val], byteOffset, encoding, dir);
      }
      throw new TypeError("val must be string, number or Buffer");
    }
    function arrayIndexOf(arr, val, byteOffset, encoding, dir) {
      let indexSize = 1;
      let arrLength = arr.length;
      let valLength = val.length;
      if (encoding !== void 0) {
        encoding = String(encoding).toLowerCase();
        if (encoding === "ucs2" || encoding === "ucs-2" || encoding === "utf16le" || encoding === "utf-16le") {
          if (arr.length < 2 || val.length < 2) {
            return -1;
          }
          indexSize = 2;
          arrLength /= 2;
          valLength /= 2;
          byteOffset /= 2;
        }
      }
      function read(buf, i3) {
        if (indexSize === 1) {
          return buf[i3];
        } else {
          return buf.readUInt16BE(i3 * indexSize);
        }
      }
      let i2;
      if (dir) {
        let foundIndex = -1;
        for (i2 = byteOffset; i2 < arrLength; i2++) {
          if (read(arr, i2) === read(val, foundIndex === -1 ? 0 : i2 - foundIndex)) {
            if (foundIndex === -1) foundIndex = i2;
            if (i2 - foundIndex + 1 === valLength) return foundIndex * indexSize;
          } else {
            if (foundIndex !== -1) i2 -= i2 - foundIndex;
            foundIndex = -1;
          }
        }
      } else {
        if (byteOffset + valLength > arrLength) byteOffset = arrLength - valLength;
        for (i2 = byteOffset; i2 >= 0; i2--) {
          let found = true;
          for (let j = 0; j < valLength; j++) {
            if (read(arr, i2 + j) !== read(val, j)) {
              found = false;
              break;
            }
          }
          if (found) return i2;
        }
      }
      return -1;
    }
    Buffer3.prototype.includes = function includes(val, byteOffset, encoding) {
      return this.indexOf(val, byteOffset, encoding) !== -1;
    };
    Buffer3.prototype.indexOf = function indexOf(val, byteOffset, encoding) {
      return bidirectionalIndexOf(this, val, byteOffset, encoding, true);
    };
    Buffer3.prototype.lastIndexOf = function lastIndexOf(val, byteOffset, encoding) {
      return bidirectionalIndexOf(this, val, byteOffset, encoding, false);
    };
    function hexWrite(buf, string, offset, length) {
      offset = Number(offset) || 0;
      const remaining = buf.length - offset;
      if (!length) {
        length = remaining;
      } else {
        length = Number(length);
        if (length > remaining) {
          length = remaining;
        }
      }
      const strLen = string.length;
      if (length > strLen / 2) {
        length = strLen / 2;
      }
      let i2;
      for (i2 = 0; i2 < length; ++i2) {
        const parsed = parseInt(string.substr(i2 * 2, 2), 16);
        if (numberIsNaN(parsed)) return i2;
        buf[offset + i2] = parsed;
      }
      return i2;
    }
    function utf8Write(buf, string, offset, length) {
      return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length);
    }
    function asciiWrite(buf, string, offset, length) {
      return blitBuffer(asciiToBytes(string), buf, offset, length);
    }
    function base64Write(buf, string, offset, length) {
      return blitBuffer(base64ToBytes2(string), buf, offset, length);
    }
    function ucs2Write(buf, string, offset, length) {
      return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length);
    }
    Buffer3.prototype.write = function write(string, offset, length, encoding) {
      if (offset === void 0) {
        encoding = "utf8";
        length = this.length;
        offset = 0;
      } else if (length === void 0 && typeof offset === "string") {
        encoding = offset;
        length = this.length;
        offset = 0;
      } else if (isFinite(offset)) {
        offset = offset >>> 0;
        if (isFinite(length)) {
          length = length >>> 0;
          if (encoding === void 0) encoding = "utf8";
        } else {
          encoding = length;
          length = void 0;
        }
      } else {
        throw new Error(
          "Buffer.write(string, encoding, offset[, length]) is no longer supported"
        );
      }
      const remaining = this.length - offset;
      if (length === void 0 || length > remaining) length = remaining;
      if (string.length > 0 && (length < 0 || offset < 0) || offset > this.length) {
        throw new RangeError("Attempt to write outside buffer bounds");
      }
      if (!encoding) encoding = "utf8";
      let loweredCase = false;
      for (; ; ) {
        switch (encoding) {
          case "hex":
            return hexWrite(this, string, offset, length);
          case "utf8":
          case "utf-8":
            return utf8Write(this, string, offset, length);
          case "ascii":
          case "latin1":
          case "binary":
            return asciiWrite(this, string, offset, length);
          case "base64":
            return base64Write(this, string, offset, length);
          case "ucs2":
          case "ucs-2":
          case "utf16le":
          case "utf-16le":
            return ucs2Write(this, string, offset, length);
          default:
            if (loweredCase) throw new TypeError("Unknown encoding: " + encoding);
            encoding = ("" + encoding).toLowerCase();
            loweredCase = true;
        }
      }
    };
    Buffer3.prototype.toJSON = function toJSON() {
      return {
        type: "Buffer",
        data: Array.prototype.slice.call(this._arr || this, 0)
      };
    };
    function base64Slice(buf, start, end) {
      if (start === 0 && end === buf.length) {
        return base64.fromByteArray(buf);
      } else {
        return base64.fromByteArray(buf.slice(start, end));
      }
    }
    function utf8Slice(buf, start, end) {
      end = Math.min(buf.length, end);
      const res = [];
      let i2 = start;
      while (i2 < end) {
        const firstByte = buf[i2];
        let codePoint = null;
        let bytesPerSequence = firstByte > 239 ? 4 : firstByte > 223 ? 3 : firstByte > 191 ? 2 : 1;
        if (i2 + bytesPerSequence <= end) {
          let secondByte, thirdByte, fourthByte, tempCodePoint;
          switch (bytesPerSequence) {
            case 1:
              if (firstByte < 128) {
                codePoint = firstByte;
              }
              break;
            case 2:
              secondByte = buf[i2 + 1];
              if ((secondByte & 192) === 128) {
                tempCodePoint = (firstByte & 31) << 6 | secondByte & 63;
                if (tempCodePoint > 127) {
                  codePoint = tempCodePoint;
                }
              }
              break;
            case 3:
              secondByte = buf[i2 + 1];
              thirdByte = buf[i2 + 2];
              if ((secondByte & 192) === 128 && (thirdByte & 192) === 128) {
                tempCodePoint = (firstByte & 15) << 12 | (secondByte & 63) << 6 | thirdByte & 63;
                if (tempCodePoint > 2047 && (tempCodePoint < 55296 || tempCodePoint > 57343)) {
                  codePoint = tempCodePoint;
                }
              }
              break;
            case 4:
              secondByte = buf[i2 + 1];
              thirdByte = buf[i2 + 2];
              fourthByte = buf[i2 + 3];
              if ((secondByte & 192) === 128 && (thirdByte & 192) === 128 && (fourthByte & 192) === 128) {
                tempCodePoint = (firstByte & 15) << 18 | (secondByte & 63) << 12 | (thirdByte & 63) << 6 | fourthByte & 63;
                if (tempCodePoint > 65535 && tempCodePoint < 1114112) {
                  codePoint = tempCodePoint;
                }
              }
          }
        }
        if (codePoint === null) {
          codePoint = 65533;
          bytesPerSequence = 1;
        } else if (codePoint > 65535) {
          codePoint -= 65536;
          res.push(codePoint >>> 10 & 1023 | 55296);
          codePoint = 56320 | codePoint & 1023;
        }
        res.push(codePoint);
        i2 += bytesPerSequence;
      }
      return decodeCodePointsArray(res);
    }
    var MAX_ARGUMENTS_LENGTH = 4096;
    function decodeCodePointsArray(codePoints) {
      const len = codePoints.length;
      if (len <= MAX_ARGUMENTS_LENGTH) {
        return String.fromCharCode.apply(String, codePoints);
      }
      let res = "";
      let i2 = 0;
      while (i2 < len) {
        res += String.fromCharCode.apply(
          String,
          codePoints.slice(i2, i2 += MAX_ARGUMENTS_LENGTH)
        );
      }
      return res;
    }
    function asciiSlice(buf, start, end) {
      let ret = "";
      end = Math.min(buf.length, end);
      for (let i2 = start; i2 < end; ++i2) {
        ret += String.fromCharCode(buf[i2] & 127);
      }
      return ret;
    }
    function latin1Slice(buf, start, end) {
      let ret = "";
      end = Math.min(buf.length, end);
      for (let i2 = start; i2 < end; ++i2) {
        ret += String.fromCharCode(buf[i2]);
      }
      return ret;
    }
    function hexSlice(buf, start, end) {
      const len = buf.length;
      if (!start || start < 0) start = 0;
      if (!end || end < 0 || end > len) end = len;
      let out = "";
      for (let i2 = start; i2 < end; ++i2) {
        out += hexSliceLookupTable[buf[i2]];
      }
      return out;
    }
    function utf16leSlice(buf, start, end) {
      const bytes = buf.slice(start, end);
      let res = "";
      for (let i2 = 0; i2 < bytes.length - 1; i2 += 2) {
        res += String.fromCharCode(bytes[i2] + bytes[i2 + 1] * 256);
      }
      return res;
    }
    Buffer3.prototype.slice = function slice(start, end) {
      const len = this.length;
      start = ~~start;
      end = end === void 0 ? len : ~~end;
      if (start < 0) {
        start += len;
        if (start < 0) start = 0;
      } else if (start > len) {
        start = len;
      }
      if (end < 0) {
        end += len;
        if (end < 0) end = 0;
      } else if (end > len) {
        end = len;
      }
      if (end < start) end = start;
      const newBuf = this.subarray(start, end);
      Object.setPrototypeOf(newBuf, Buffer3.prototype);
      return newBuf;
    };
    function checkOffset(offset, ext, length) {
      if (offset % 1 !== 0 || offset < 0) throw new RangeError("offset is not uint");
      if (offset + ext > length) throw new RangeError("Trying to access beyond buffer length");
    }
    Buffer3.prototype.readUintLE = Buffer3.prototype.readUIntLE = function readUIntLE(offset, byteLength2, noAssert) {
      offset = offset >>> 0;
      byteLength2 = byteLength2 >>> 0;
      if (!noAssert) checkOffset(offset, byteLength2, this.length);
      let val = this[offset];
      let mul = 1;
      let i2 = 0;
      while (++i2 < byteLength2 && (mul *= 256)) {
        val += this[offset + i2] * mul;
      }
      return val;
    };
    Buffer3.prototype.readUintBE = Buffer3.prototype.readUIntBE = function readUIntBE(offset, byteLength2, noAssert) {
      offset = offset >>> 0;
      byteLength2 = byteLength2 >>> 0;
      if (!noAssert) {
        checkOffset(offset, byteLength2, this.length);
      }
      let val = this[offset + --byteLength2];
      let mul = 1;
      while (byteLength2 > 0 && (mul *= 256)) {
        val += this[offset + --byteLength2] * mul;
      }
      return val;
    };
    Buffer3.prototype.readUint8 = Buffer3.prototype.readUInt8 = function readUInt8(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 1, this.length);
      return this[offset];
    };
    Buffer3.prototype.readUint16LE = Buffer3.prototype.readUInt16LE = function readUInt16LE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 2, this.length);
      return this[offset] | this[offset + 1] << 8;
    };
    Buffer3.prototype.readUint16BE = Buffer3.prototype.readUInt16BE = function readUInt16BE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 2, this.length);
      return this[offset] << 8 | this[offset + 1];
    };
    Buffer3.prototype.readUint32LE = Buffer3.prototype.readUInt32LE = function readUInt32LE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 4, this.length);
      return (this[offset] | this[offset + 1] << 8 | this[offset + 2] << 16) + this[offset + 3] * 16777216;
    };
    Buffer3.prototype.readUint32BE = Buffer3.prototype.readUInt32BE = function readUInt32BE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 4, this.length);
      return this[offset] * 16777216 + (this[offset + 1] << 16 | this[offset + 2] << 8 | this[offset + 3]);
    };
    Buffer3.prototype.readBigUInt64LE = defineBigIntMethod(function readBigUInt64LE(offset) {
      offset = offset >>> 0;
      validateNumber(offset, "offset");
      const first = this[offset];
      const last = this[offset + 7];
      if (first === void 0 || last === void 0) {
        boundsError(offset, this.length - 8);
      }
      const lo = first + this[++offset] * 2 ** 8 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 24;
      const hi = this[++offset] + this[++offset] * 2 ** 8 + this[++offset] * 2 ** 16 + last * 2 ** 24;
      return BigInt(lo) + (BigInt(hi) << BigInt(32));
    });
    Buffer3.prototype.readBigUInt64BE = defineBigIntMethod(function readBigUInt64BE(offset) {
      offset = offset >>> 0;
      validateNumber(offset, "offset");
      const first = this[offset];
      const last = this[offset + 7];
      if (first === void 0 || last === void 0) {
        boundsError(offset, this.length - 8);
      }
      const hi = first * 2 ** 24 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 8 + this[++offset];
      const lo = this[++offset] * 2 ** 24 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 8 + last;
      return (BigInt(hi) << BigInt(32)) + BigInt(lo);
    });
    Buffer3.prototype.readIntLE = function readIntLE(offset, byteLength2, noAssert) {
      offset = offset >>> 0;
      byteLength2 = byteLength2 >>> 0;
      if (!noAssert) checkOffset(offset, byteLength2, this.length);
      let val = this[offset];
      let mul = 1;
      let i2 = 0;
      while (++i2 < byteLength2 && (mul *= 256)) {
        val += this[offset + i2] * mul;
      }
      mul *= 128;
      if (val >= mul) val -= Math.pow(2, 8 * byteLength2);
      return val;
    };
    Buffer3.prototype.readIntBE = function readIntBE(offset, byteLength2, noAssert) {
      offset = offset >>> 0;
      byteLength2 = byteLength2 >>> 0;
      if (!noAssert) checkOffset(offset, byteLength2, this.length);
      let i2 = byteLength2;
      let mul = 1;
      let val = this[offset + --i2];
      while (i2 > 0 && (mul *= 256)) {
        val += this[offset + --i2] * mul;
      }
      mul *= 128;
      if (val >= mul) val -= Math.pow(2, 8 * byteLength2);
      return val;
    };
    Buffer3.prototype.readInt8 = function readInt8(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 1, this.length);
      if (!(this[offset] & 128)) return this[offset];
      return (255 - this[offset] + 1) * -1;
    };
    Buffer3.prototype.readInt16LE = function readInt16LE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 2, this.length);
      const val = this[offset] | this[offset + 1] << 8;
      return val & 32768 ? val | 4294901760 : val;
    };
    Buffer3.prototype.readInt16BE = function readInt16BE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 2, this.length);
      const val = this[offset + 1] | this[offset] << 8;
      return val & 32768 ? val | 4294901760 : val;
    };
    Buffer3.prototype.readInt32LE = function readInt32LE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 4, this.length);
      return this[offset] | this[offset + 1] << 8 | this[offset + 2] << 16 | this[offset + 3] << 24;
    };
    Buffer3.prototype.readInt32BE = function readInt32BE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 4, this.length);
      return this[offset] << 24 | this[offset + 1] << 16 | this[offset + 2] << 8 | this[offset + 3];
    };
    Buffer3.prototype.readBigInt64LE = defineBigIntMethod(function readBigInt64LE(offset) {
      offset = offset >>> 0;
      validateNumber(offset, "offset");
      const first = this[offset];
      const last = this[offset + 7];
      if (first === void 0 || last === void 0) {
        boundsError(offset, this.length - 8);
      }
      const val = this[offset + 4] + this[offset + 5] * 2 ** 8 + this[offset + 6] * 2 ** 16 + (last << 24);
      return (BigInt(val) << BigInt(32)) + BigInt(first + this[++offset] * 2 ** 8 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 24);
    });
    Buffer3.prototype.readBigInt64BE = defineBigIntMethod(function readBigInt64BE(offset) {
      offset = offset >>> 0;
      validateNumber(offset, "offset");
      const first = this[offset];
      const last = this[offset + 7];
      if (first === void 0 || last === void 0) {
        boundsError(offset, this.length - 8);
      }
      const val = (first << 24) + // Overflow
      this[++offset] * 2 ** 16 + this[++offset] * 2 ** 8 + this[++offset];
      return (BigInt(val) << BigInt(32)) + BigInt(this[++offset] * 2 ** 24 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 8 + last);
    });
    Buffer3.prototype.readFloatLE = function readFloatLE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 4, this.length);
      return ieee754.read(this, offset, true, 23, 4);
    };
    Buffer3.prototype.readFloatBE = function readFloatBE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 4, this.length);
      return ieee754.read(this, offset, false, 23, 4);
    };
    Buffer3.prototype.readDoubleLE = function readDoubleLE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 8, this.length);
      return ieee754.read(this, offset, true, 52, 8);
    };
    Buffer3.prototype.readDoubleBE = function readDoubleBE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 8, this.length);
      return ieee754.read(this, offset, false, 52, 8);
    };
    function checkInt(buf, value, offset, ext, max, min) {
      if (!Buffer3.isBuffer(buf)) throw new TypeError('"buffer" argument must be a Buffer instance');
      if (value > max || value < min) throw new RangeError('"value" argument is out of bounds');
      if (offset + ext > buf.length) throw new RangeError("Index out of range");
    }
    Buffer3.prototype.writeUintLE = Buffer3.prototype.writeUIntLE = function writeUIntLE(value, offset, byteLength2, noAssert) {
      value = +value;
      offset = offset >>> 0;
      byteLength2 = byteLength2 >>> 0;
      if (!noAssert) {
        const maxBytes = Math.pow(2, 8 * byteLength2) - 1;
        checkInt(this, value, offset, byteLength2, maxBytes, 0);
      }
      let mul = 1;
      let i2 = 0;
      this[offset] = value & 255;
      while (++i2 < byteLength2 && (mul *= 256)) {
        this[offset + i2] = value / mul & 255;
      }
      return offset + byteLength2;
    };
    Buffer3.prototype.writeUintBE = Buffer3.prototype.writeUIntBE = function writeUIntBE(value, offset, byteLength2, noAssert) {
      value = +value;
      offset = offset >>> 0;
      byteLength2 = byteLength2 >>> 0;
      if (!noAssert) {
        const maxBytes = Math.pow(2, 8 * byteLength2) - 1;
        checkInt(this, value, offset, byteLength2, maxBytes, 0);
      }
      let i2 = byteLength2 - 1;
      let mul = 1;
      this[offset + i2] = value & 255;
      while (--i2 >= 0 && (mul *= 256)) {
        this[offset + i2] = value / mul & 255;
      }
      return offset + byteLength2;
    };
    Buffer3.prototype.writeUint8 = Buffer3.prototype.writeUInt8 = function writeUInt8(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 1, 255, 0);
      this[offset] = value & 255;
      return offset + 1;
    };
    Buffer3.prototype.writeUint16LE = Buffer3.prototype.writeUInt16LE = function writeUInt16LE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 2, 65535, 0);
      this[offset] = value & 255;
      this[offset + 1] = value >>> 8;
      return offset + 2;
    };
    Buffer3.prototype.writeUint16BE = Buffer3.prototype.writeUInt16BE = function writeUInt16BE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 2, 65535, 0);
      this[offset] = value >>> 8;
      this[offset + 1] = value & 255;
      return offset + 2;
    };
    Buffer3.prototype.writeUint32LE = Buffer3.prototype.writeUInt32LE = function writeUInt32LE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 4, 4294967295, 0);
      this[offset + 3] = value >>> 24;
      this[offset + 2] = value >>> 16;
      this[offset + 1] = value >>> 8;
      this[offset] = value & 255;
      return offset + 4;
    };
    Buffer3.prototype.writeUint32BE = Buffer3.prototype.writeUInt32BE = function writeUInt32BE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 4, 4294967295, 0);
      this[offset] = value >>> 24;
      this[offset + 1] = value >>> 16;
      this[offset + 2] = value >>> 8;
      this[offset + 3] = value & 255;
      return offset + 4;
    };
    function wrtBigUInt64LE(buf, value, offset, min, max) {
      checkIntBI(value, min, max, buf, offset, 7);
      let lo = Number(value & BigInt(4294967295));
      buf[offset++] = lo;
      lo = lo >> 8;
      buf[offset++] = lo;
      lo = lo >> 8;
      buf[offset++] = lo;
      lo = lo >> 8;
      buf[offset++] = lo;
      let hi = Number(value >> BigInt(32) & BigInt(4294967295));
      buf[offset++] = hi;
      hi = hi >> 8;
      buf[offset++] = hi;
      hi = hi >> 8;
      buf[offset++] = hi;
      hi = hi >> 8;
      buf[offset++] = hi;
      return offset;
    }
    function wrtBigUInt64BE(buf, value, offset, min, max) {
      checkIntBI(value, min, max, buf, offset, 7);
      let lo = Number(value & BigInt(4294967295));
      buf[offset + 7] = lo;
      lo = lo >> 8;
      buf[offset + 6] = lo;
      lo = lo >> 8;
      buf[offset + 5] = lo;
      lo = lo >> 8;
      buf[offset + 4] = lo;
      let hi = Number(value >> BigInt(32) & BigInt(4294967295));
      buf[offset + 3] = hi;
      hi = hi >> 8;
      buf[offset + 2] = hi;
      hi = hi >> 8;
      buf[offset + 1] = hi;
      hi = hi >> 8;
      buf[offset] = hi;
      return offset + 8;
    }
    Buffer3.prototype.writeBigUInt64LE = defineBigIntMethod(function writeBigUInt64LE(value, offset = 0) {
      return wrtBigUInt64LE(this, value, offset, BigInt(0), BigInt("0xffffffffffffffff"));
    });
    Buffer3.prototype.writeBigUInt64BE = defineBigIntMethod(function writeBigUInt64BE(value, offset = 0) {
      return wrtBigUInt64BE(this, value, offset, BigInt(0), BigInt("0xffffffffffffffff"));
    });
    Buffer3.prototype.writeIntLE = function writeIntLE(value, offset, byteLength2, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) {
        const limit = Math.pow(2, 8 * byteLength2 - 1);
        checkInt(this, value, offset, byteLength2, limit - 1, -limit);
      }
      let i2 = 0;
      let mul = 1;
      let sub = 0;
      this[offset] = value & 255;
      while (++i2 < byteLength2 && (mul *= 256)) {
        if (value < 0 && sub === 0 && this[offset + i2 - 1] !== 0) {
          sub = 1;
        }
        this[offset + i2] = (value / mul >> 0) - sub & 255;
      }
      return offset + byteLength2;
    };
    Buffer3.prototype.writeIntBE = function writeIntBE(value, offset, byteLength2, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) {
        const limit = Math.pow(2, 8 * byteLength2 - 1);
        checkInt(this, value, offset, byteLength2, limit - 1, -limit);
      }
      let i2 = byteLength2 - 1;
      let mul = 1;
      let sub = 0;
      this[offset + i2] = value & 255;
      while (--i2 >= 0 && (mul *= 256)) {
        if (value < 0 && sub === 0 && this[offset + i2 + 1] !== 0) {
          sub = 1;
        }
        this[offset + i2] = (value / mul >> 0) - sub & 255;
      }
      return offset + byteLength2;
    };
    Buffer3.prototype.writeInt8 = function writeInt8(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 1, 127, -128);
      if (value < 0) value = 255 + value + 1;
      this[offset] = value & 255;
      return offset + 1;
    };
    Buffer3.prototype.writeInt16LE = function writeInt16LE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 2, 32767, -32768);
      this[offset] = value & 255;
      this[offset + 1] = value >>> 8;
      return offset + 2;
    };
    Buffer3.prototype.writeInt16BE = function writeInt16BE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 2, 32767, -32768);
      this[offset] = value >>> 8;
      this[offset + 1] = value & 255;
      return offset + 2;
    };
    Buffer3.prototype.writeInt32LE = function writeInt32LE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 4, 2147483647, -2147483648);
      this[offset] = value & 255;
      this[offset + 1] = value >>> 8;
      this[offset + 2] = value >>> 16;
      this[offset + 3] = value >>> 24;
      return offset + 4;
    };
    Buffer3.prototype.writeInt32BE = function writeInt32BE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 4, 2147483647, -2147483648);
      if (value < 0) value = 4294967295 + value + 1;
      this[offset] = value >>> 24;
      this[offset + 1] = value >>> 16;
      this[offset + 2] = value >>> 8;
      this[offset + 3] = value & 255;
      return offset + 4;
    };
    Buffer3.prototype.writeBigInt64LE = defineBigIntMethod(function writeBigInt64LE(value, offset = 0) {
      return wrtBigUInt64LE(this, value, offset, -BigInt("0x8000000000000000"), BigInt("0x7fffffffffffffff"));
    });
    Buffer3.prototype.writeBigInt64BE = defineBigIntMethod(function writeBigInt64BE(value, offset = 0) {
      return wrtBigUInt64BE(this, value, offset, -BigInt("0x8000000000000000"), BigInt("0x7fffffffffffffff"));
    });
    function checkIEEE754(buf, value, offset, ext, max, min) {
      if (offset + ext > buf.length) throw new RangeError("Index out of range");
      if (offset < 0) throw new RangeError("Index out of range");
    }
    function writeFloat(buf, value, offset, littleEndian, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) {
        checkIEEE754(buf, value, offset, 4, 34028234663852886e22, -34028234663852886e22);
      }
      ieee754.write(buf, value, offset, littleEndian, 23, 4);
      return offset + 4;
    }
    Buffer3.prototype.writeFloatLE = function writeFloatLE(value, offset, noAssert) {
      return writeFloat(this, value, offset, true, noAssert);
    };
    Buffer3.prototype.writeFloatBE = function writeFloatBE(value, offset, noAssert) {
      return writeFloat(this, value, offset, false, noAssert);
    };
    function writeDouble(buf, value, offset, littleEndian, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) {
        checkIEEE754(buf, value, offset, 8, 17976931348623157e292, -17976931348623157e292);
      }
      ieee754.write(buf, value, offset, littleEndian, 52, 8);
      return offset + 8;
    }
    Buffer3.prototype.writeDoubleLE = function writeDoubleLE(value, offset, noAssert) {
      return writeDouble(this, value, offset, true, noAssert);
    };
    Buffer3.prototype.writeDoubleBE = function writeDoubleBE(value, offset, noAssert) {
      return writeDouble(this, value, offset, false, noAssert);
    };
    Buffer3.prototype.copy = function copy(target, targetStart, start, end) {
      if (!Buffer3.isBuffer(target)) throw new TypeError("argument should be a Buffer");
      if (!start) start = 0;
      if (!end && end !== 0) end = this.length;
      if (targetStart >= target.length) targetStart = target.length;
      if (!targetStart) targetStart = 0;
      if (end > 0 && end < start) end = start;
      if (end === start) return 0;
      if (target.length === 0 || this.length === 0) return 0;
      if (targetStart < 0) {
        throw new RangeError("targetStart out of bounds");
      }
      if (start < 0 || start >= this.length) throw new RangeError("Index out of range");
      if (end < 0) throw new RangeError("sourceEnd out of bounds");
      if (end > this.length) end = this.length;
      if (target.length - targetStart < end - start) {
        end = target.length - targetStart + start;
      }
      const len = end - start;
      if (this === target && typeof Uint8Array.prototype.copyWithin === "function") {
        this.copyWithin(targetStart, start, end);
      } else {
        Uint8Array.prototype.set.call(
          target,
          this.subarray(start, end),
          targetStart
        );
      }
      return len;
    };
    Buffer3.prototype.fill = function fill(val, start, end, encoding) {
      if (typeof val === "string") {
        if (typeof start === "string") {
          encoding = start;
          start = 0;
          end = this.length;
        } else if (typeof end === "string") {
          encoding = end;
          end = this.length;
        }
        if (encoding !== void 0 && typeof encoding !== "string") {
          throw new TypeError("encoding must be a string");
        }
        if (typeof encoding === "string" && !Buffer3.isEncoding(encoding)) {
          throw new TypeError("Unknown encoding: " + encoding);
        }
        if (val.length === 1) {
          const code = val.charCodeAt(0);
          if (encoding === "utf8" && code < 128 || encoding === "latin1") {
            val = code;
          }
        }
      } else if (typeof val === "number") {
        val = val & 255;
      } else if (typeof val === "boolean") {
        val = Number(val);
      }
      if (start < 0 || this.length < start || this.length < end) {
        throw new RangeError("Out of range index");
      }
      if (end <= start) {
        return this;
      }
      start = start >>> 0;
      end = end === void 0 ? this.length : end >>> 0;
      if (!val) val = 0;
      let i2;
      if (typeof val === "number") {
        for (i2 = start; i2 < end; ++i2) {
          this[i2] = val;
        }
      } else {
        const bytes = Buffer3.isBuffer(val) ? val : Buffer3.from(val, encoding);
        const len = bytes.length;
        if (len === 0) {
          throw new TypeError('The value "' + val + '" is invalid for argument "value"');
        }
        for (i2 = 0; i2 < end - start; ++i2) {
          this[i2 + start] = bytes[i2 % len];
        }
      }
      return this;
    };
    var errors = {};
    function E2(sym, getMessage, Base) {
      errors[sym] = class NodeError extends Base {
        constructor() {
          super();
          Object.defineProperty(this, "message", {
            value: getMessage.apply(this, arguments),
            writable: true,
            configurable: true
          });
          this.name = `${this.name} [${sym}]`;
          this.stack;
          delete this.name;
        }
        get code() {
          return sym;
        }
        set code(value) {
          Object.defineProperty(this, "code", {
            configurable: true,
            enumerable: true,
            value,
            writable: true
          });
        }
        toString() {
          return `${this.name} [${sym}]: ${this.message}`;
        }
      };
    }
    E2(
      "ERR_BUFFER_OUT_OF_BOUNDS",
      function(name) {
        if (name) {
          return `${name} is outside of buffer bounds`;
        }
        return "Attempt to access memory outside buffer bounds";
      },
      RangeError
    );
    E2(
      "ERR_INVALID_ARG_TYPE",
      function(name, actual) {
        return `The "${name}" argument must be of type number. Received type ${typeof actual}`;
      },
      TypeError
    );
    E2(
      "ERR_OUT_OF_RANGE",
      function(str, range, input) {
        let msg = `The value of "${str}" is out of range.`;
        let received = input;
        if (Number.isInteger(input) && Math.abs(input) > 2 ** 32) {
          received = addNumericalSeparator(String(input));
        } else if (typeof input === "bigint") {
          received = String(input);
          if (input > BigInt(2) ** BigInt(32) || input < -(BigInt(2) ** BigInt(32))) {
            received = addNumericalSeparator(received);
          }
          received += "n";
        }
        msg += ` It must be ${range}. Received ${received}`;
        return msg;
      },
      RangeError
    );
    function addNumericalSeparator(val) {
      let res = "";
      let i2 = val.length;
      const start = val[0] === "-" ? 1 : 0;
      for (; i2 >= start + 4; i2 -= 3) {
        res = `_${val.slice(i2 - 3, i2)}${res}`;
      }
      return `${val.slice(0, i2)}${res}`;
    }
    function checkBounds(buf, offset, byteLength2) {
      validateNumber(offset, "offset");
      if (buf[offset] === void 0 || buf[offset + byteLength2] === void 0) {
        boundsError(offset, buf.length - (byteLength2 + 1));
      }
    }
    function checkIntBI(value, min, max, buf, offset, byteLength2) {
      if (value > max || value < min) {
        const n2 = typeof min === "bigint" ? "n" : "";
        let range;
        if (byteLength2 > 3) {
          if (min === 0 || min === BigInt(0)) {
            range = `>= 0${n2} and < 2${n2} ** ${(byteLength2 + 1) * 8}${n2}`;
          } else {
            range = `>= -(2${n2} ** ${(byteLength2 + 1) * 8 - 1}${n2}) and < 2 ** ${(byteLength2 + 1) * 8 - 1}${n2}`;
          }
        } else {
          range = `>= ${min}${n2} and <= ${max}${n2}`;
        }
        throw new errors.ERR_OUT_OF_RANGE("value", range, value);
      }
      checkBounds(buf, offset, byteLength2);
    }
    function validateNumber(value, name) {
      if (typeof value !== "number") {
        throw new errors.ERR_INVALID_ARG_TYPE(name, "number", value);
      }
    }
    function boundsError(value, length, type) {
      if (Math.floor(value) !== value) {
        validateNumber(value, type);
        throw new errors.ERR_OUT_OF_RANGE(type || "offset", "an integer", value);
      }
      if (length < 0) {
        throw new errors.ERR_BUFFER_OUT_OF_BOUNDS();
      }
      throw new errors.ERR_OUT_OF_RANGE(
        type || "offset",
        `>= ${type ? 1 : 0} and <= ${length}`,
        value
      );
    }
    var INVALID_BASE64_RE = /[^+/0-9A-Za-z-_]/g;
    function base64clean(str) {
      str = str.split("=")[0];
      str = str.trim().replace(INVALID_BASE64_RE, "");
      if (str.length < 2) return "";
      while (str.length % 4 !== 0) {
        str = str + "=";
      }
      return str;
    }
    function utf8ToBytes(string, units) {
      units = units || Infinity;
      let codePoint;
      const length = string.length;
      let leadSurrogate = null;
      const bytes = [];
      for (let i2 = 0; i2 < length; ++i2) {
        codePoint = string.charCodeAt(i2);
        if (codePoint > 55295 && codePoint < 57344) {
          if (!leadSurrogate) {
            if (codePoint > 56319) {
              if ((units -= 3) > -1) bytes.push(239, 191, 189);
              continue;
            } else if (i2 + 1 === length) {
              if ((units -= 3) > -1) bytes.push(239, 191, 189);
              continue;
            }
            leadSurrogate = codePoint;
            continue;
          }
          if (codePoint < 56320) {
            if ((units -= 3) > -1) bytes.push(239, 191, 189);
            leadSurrogate = codePoint;
            continue;
          }
          codePoint = (leadSurrogate - 55296 << 10 | codePoint - 56320) + 65536;
        } else if (leadSurrogate) {
          if ((units -= 3) > -1) bytes.push(239, 191, 189);
        }
        leadSurrogate = null;
        if (codePoint < 128) {
          if ((units -= 1) < 0) break;
          bytes.push(codePoint);
        } else if (codePoint < 2048) {
          if ((units -= 2) < 0) break;
          bytes.push(
            codePoint >> 6 | 192,
            codePoint & 63 | 128
          );
        } else if (codePoint < 65536) {
          if ((units -= 3) < 0) break;
          bytes.push(
            codePoint >> 12 | 224,
            codePoint >> 6 & 63 | 128,
            codePoint & 63 | 128
          );
        } else if (codePoint < 1114112) {
          if ((units -= 4) < 0) break;
          bytes.push(
            codePoint >> 18 | 240,
            codePoint >> 12 & 63 | 128,
            codePoint >> 6 & 63 | 128,
            codePoint & 63 | 128
          );
        } else {
          throw new Error("Invalid code point");
        }
      }
      return bytes;
    }
    function asciiToBytes(str) {
      const byteArray = [];
      for (let i2 = 0; i2 < str.length; ++i2) {
        byteArray.push(str.charCodeAt(i2) & 255);
      }
      return byteArray;
    }
    function utf16leToBytes(str, units) {
      let c2, hi, lo;
      const byteArray = [];
      for (let i2 = 0; i2 < str.length; ++i2) {
        if ((units -= 2) < 0) break;
        c2 = str.charCodeAt(i2);
        hi = c2 >> 8;
        lo = c2 % 256;
        byteArray.push(lo);
        byteArray.push(hi);
      }
      return byteArray;
    }
    function base64ToBytes2(str) {
      return base64.toByteArray(base64clean(str));
    }
    function blitBuffer(src, dst, offset, length) {
      let i2;
      for (i2 = 0; i2 < length; ++i2) {
        if (i2 + offset >= dst.length || i2 >= src.length) break;
        dst[i2 + offset] = src[i2];
      }
      return i2;
    }
    function isInstance(obj, type) {
      return obj instanceof type || obj != null && obj.constructor != null && obj.constructor.name != null && obj.constructor.name === type.name;
    }
    function numberIsNaN(obj) {
      return obj !== obj;
    }
    var hexSliceLookupTable = (function() {
      const alphabet = "0123456789abcdef";
      const table = new Array(256);
      for (let i2 = 0; i2 < 16; ++i2) {
        const i16 = i2 * 16;
        for (let j = 0; j < 16; ++j) {
          table[i16 + j] = alphabet[i2] + alphabet[j];
        }
      }
      return table;
    })();
    function defineBigIntMethod(fn) {
      return typeof BigInt === "undefined" ? BufferBigIntNotDefined : fn;
    }
    function BufferBigIntNotDefined() {
      throw new Error("BigInt not supported");
    }
  }
});

// packages/quickjs-shims/src/host.ts
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
      const errno = hostErrno(message);
      throw new QuickJsShimError(errno ?? SHIM_ERROR_CODES.hostRejected, `host operation ${op} failed: ${message}`, {
        operation: op,
        details: record,
        ...errno === void 0 ? {} : { shimCode: SHIM_ERROR_CODES.hostRejected, errno }
      });
    }
    if (record["ok"] === true && "value" in record) return record["value"];
  }
  return payload;
}
function asShimError(op, cause) {
  if (cause instanceof QuickJsShimError) return cause;
  const message = cause instanceof Error ? cause.message : String(cause);
  if (/unknown host operation|unsupported|not implemented/i.test(message)) return unsupportedOperation(op, message);
  return refused(op, message);
}
function hostErrno(message) {
  return HOST_REFUSAL_ERRNOS.find((entry) => entry.pattern.test(message))?.errno;
}
function refused(op, message, details) {
  const errno = hostErrno(message);
  return new QuickJsShimError(errno ?? SHIM_ERROR_CODES.hostRejected, `host operation ${op} threw: ${message}`, {
    operation: op,
    ...errno === void 0 ? {} : { shimCode: SHIM_ERROR_CODES.hostRejected, errno },
    ...details === void 0 ? {} : details
  });
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
  const h2 = host();
  if (typeof h2.callAsync === "function") {
    let raw;
    try {
      raw = await h2.callAsync(op, JSON.stringify(args ?? {}));
    } catch (cause) {
      throw asShimError(op, cause);
    }
    if (!(typeof raw === "string")) {
      throw new QuickJsShimError(SHIM_ERROR_CODES.hostResultInvalid, `host operation ${op} answered bytes to a text call; ask for it through hostCallBytesAsync.`, { operation: op });
    }
    return decodeHostResult(op, raw);
  }
  return hostCall(op, args);
}
function hostCallBytes(op, args) {
  const h2 = host();
  if (typeof h2.callBytes !== "function") {
    throw new QuickJsShimError(SHIM_ERROR_CODES.hostMissing, `${op} answers bytes but this host installed no __xrh.callBytes.`, { operation: op });
  }
  let answer;
  try {
    answer = h2.callBytes(op, JSON.stringify(args ?? {}));
  } catch (cause) {
    throw asShimError(op, cause);
  }
  if (answer === void 0) {
    throw new QuickJsShimError(SHIM_ERROR_CODES.hostResultInvalid, `${op} parked no byte answer.`, { operation: op });
  }
  if (answer === null) return null;
  if (!(answer instanceof Uint8Array)) {
    throw new QuickJsShimError(SHIM_ERROR_CODES.hostResultInvalid, `${op} answered something that is not a Uint8Array.`, { operation: op });
  }
  return answer;
}
async function hostCallBytesAsync(op, args) {
  const h2 = host();
  if (typeof h2.callAsync !== "function") return hostCallBytes(op, args);
  let answer;
  try {
    answer = await h2.callAsync(op, JSON.stringify(args ?? {}));
  } catch (cause) {
    throw asShimError(op, cause);
  }
  if (typeof answer === "string") {
    throw new QuickJsShimError(SHIM_ERROR_CODES.hostResultInvalid, `${op} answered text to a byte call: ${answer.slice(0, 160)}`, { operation: op });
  }
  if (answer === null || answer instanceof Uint8Array) return answer;
  throw new QuickJsShimError(SHIM_ERROR_CODES.hostResultInvalid, `${op} answered something that is not a Uint8Array.`, { operation: op });
}
function hostSendBytes(op, args, bytes) {
  const h2 = host();
  if (typeof h2.sendBytes !== "function") {
    throw new QuickJsShimError(SHIM_ERROR_CODES.hostMissing, `${op} takes a byte payload but this host installed no __xrh.sendBytes.`, { operation: op });
  }
  let raw;
  try {
    raw = h2.sendBytes(op, JSON.stringify(args ?? {}), bytes);
  } catch (cause) {
    throw asShimError(op, cause);
  }
  return decodeHostResult(op, raw);
}
async function hostSendBytesAsync(op, args, bytes) {
  const h2 = host();
  if (typeof h2.callAsync !== "function") return hostSendBytes(op, args, bytes);
  let raw;
  try {
    raw = await h2.callAsync(op, JSON.stringify(args ?? {}), bytes);
  } catch (cause) {
    throw asShimError(op, cause);
  }
  if (typeof raw !== "string") {
    throw new QuickJsShimError(SHIM_ERROR_CODES.hostResultInvalid, `${op} answered bytes to a payload call.`, { operation: op });
  }
  return decodeHostResult(op, raw);
}
function hexToBytes(value) {
  const clean5 = value.length % 2 === 0 ? value : value.slice(0, value.length - 1);
  const out = new Uint8Array(Math.floor(clean5.length / 2));
  for (let index = 0; index < out.length; index += 1) {
    const byte = Number.parseInt(clean5.slice(index * 2, index * 2 + 2), 16);
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
function bytesToLatin1(bytes) {
  let output = "";
  for (const byte of bytes) output += String.fromCharCode(byte);
  return output;
}
var HOST_GLOBAL_KEY, SHIM_ERROR_CODES, QuickJsShimError, HOST_REFUSAL_ERRNOS, OPERATIONS_V1, OPERATIONS_V2_REQUESTED, FALLBACK_PLATFORM_INFO, cachedPlatform, cachedEnv, BASE64_ALPHABET;
var init_host = __esm({
  "packages/quickjs-shims/src/host.ts"() {
    "use strict";
    init_src();
    HOST_GLOBAL_KEY = "__xrh";
    SHIM_ERROR_CODES = {
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
    QuickJsShimError = class extends Error {
      /**
       * Node's own error field. It carries a `quickjs-shim-*` code when the refusal is the shim's (an unwired
       * member, an unusable signature, a missing host operation) and a Node errno (`ENOENT`, `EEXIST`, `EACCES`)
       * when the host refused for a condition Node names — because every retained node's `platform.ts` branches on
       * `err.code`, and a shim code there would read as "some other error". The original shim code stays in
       * `details.shimCode`.
       */
      code;
      details;
      constructor(code, message, details) {
        super(message);
        this.name = "QuickJsShimError";
        this.code = code;
        if (details !== void 0) this.details = details;
      }
    };
    HOST_REFUSAL_ERRNOS = [
      { pattern: /destination already exists/i, errno: "EEXIST" },
      { pattern: /outside the authorized roots/i, errno: "EACCES" }
    ];
    OPERATIONS_V1 = [
      "fs.stat",
      "fs.list",
      "fs.readText",
      "fs.writeText",
      "fs.ensureDir",
      "fs.move",
      "fs.delete",
      // Answered by the executor since it widened `fs_operations`, and wired here as of this list: a member that
      // needs one now makes a call instead of throwing. All of these go through the granted filesystem, so a host
      // without a grant refuses them (`fs_operations.rs:292-298`) — that refusal is the host's answer, not a check
      // duplicated in JS.
      "fs.mkdtemp",
      "fs.copy",
      "fs.appendText",
      "fs.utimes",
      "fs.link",
      "fs.symlink",
      "fs.readlink",
      "fs.realpath",
      // The byte pair, over `__xrh.callBytes` / `__xrh.sendBytes` rather than the JSON envelope (ADR-0071). Single
      // buffer ceiling is 8 MiB (`filesystem.rs:42`); an offset past EOF answers an **empty** buffer, not null.
      "fs.readBytes",
      "fs.writeBytes",
      "proc.exec",
      // The handle family, consumed by `child_process.spawn` for the `stdio: "ignore"` case only: `proc.spawn`
      // answers `{ handle, pid, program }`, `proc.wait` blocks to completion, `proc.kill` ends it. `proc.poll` is
      // deliberately not wired here — reading its transcript windows would mean shipping a `ChildProcess` whose output
      // is capped (4 MiB per stream, 262144 B per window), which is a fake of Node's pipe semantics rather than a port.
      "proc.spawn",
      "proc.wait",
      "proc.kill",
      "clock.now",
      "crypto.randomUUID",
      "crypto.randomBytes",
      // One-shot digest over a byte payload, answered by the host's own sha1/sha256 — `crypto.createHash` and
      // `crypto.hash` in `crypto.ts` buffer the input and ask the host, so there is exactly one hash per algorithm.
      "crypto.digest",
      "os.tmpdir",
      "os.homedir",
      // The host answers `{ count, cpus: [{ model, speed, logical }] }` — there is no per-CPU `times`, so `os.ts`
      // hands back the list it is given rather than inventing idle/user counters.
      "os.cpus",
      // The one door to a host service. Its own arguments carry the domain vocabulary
      // (`{ service, method, args }`), so a node's engine never adds members to this list.
      "service.invoke"
    ];
    OPERATIONS_V2_REQUESTED = [
      "proc.poll(handle, { since }) -> { running, exitCode, stdout, stderr, stdoutOffset, stderrOffset, truncated }  // answered, unwired on purpose: reading it needs a ChildProcess stream shape whose output the host caps"
    ];
    FALLBACK_PLATFORM_INFO = { platform: "linux", arch: "unknown", sep: "/", pathSep: ":", cwd: "/", env: "{}" };
    BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  }
});

// packages/quickjs-shims/src/constants.ts
var POSIX_OPEN_FLAGS, WINDOWS_OPEN_FLAGS, OPEN_FLAGS, F_OK, R_OK, W_OK, X_OK, COPYFILE_EXCL, COPYFILE_FICLONE, COPYFILE_FICLONE_FORCE, S_IFMT, S_IFDIR, S_IFREG, S_IFLNK, S_IFBLK, S_IFCHR, S_IFIFO, S_IFSOCK, S_IRUSR, S_IWUSR, S_IXUSR, S_IRGRP, S_IWGRP, S_IXGRP, S_IROTH, S_IWOTH, S_IXOTH, O_RDONLY, O_WRONLY, O_RDWR, O_CREAT, O_EXCL, O_NOCTTY, O_TRUNC, O_APPEND, O_DIRECT, O_DIRECTORY, O_NOFOLLOW, O_NOATIME, O_CLOEXEC, constants;
var init_constants = __esm({
  "packages/quickjs-shims/src/constants.ts"() {
    "use strict";
    init_src();
    init_host();
    POSIX_OPEN_FLAGS = {
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
    WINDOWS_OPEN_FLAGS = {
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
    OPEN_FLAGS = platformInfoOrFallback().platform === "win32" ? WINDOWS_OPEN_FLAGS : POSIX_OPEN_FLAGS;
    F_OK = 0;
    R_OK = 4;
    W_OK = 2;
    X_OK = 1;
    COPYFILE_EXCL = 1;
    COPYFILE_FICLONE = 2;
    COPYFILE_FICLONE_FORCE = 4;
    S_IFMT = 61440;
    S_IFDIR = 16384;
    S_IFREG = 33188 & 61440;
    S_IFLNK = 40960;
    S_IFBLK = 24576;
    S_IFCHR = 8192;
    S_IFIFO = 4096;
    S_IFSOCK = 49152;
    S_IRUSR = 256;
    S_IWUSR = 128;
    S_IXUSR = 64;
    S_IRGRP = 32;
    S_IWGRP = 16;
    S_IXGRP = 8;
    S_IROTH = 4;
    S_IWOTH = 2;
    S_IXOTH = 1;
    O_RDONLY = OPEN_FLAGS.O_RDONLY;
    O_WRONLY = OPEN_FLAGS.O_WRONLY;
    O_RDWR = OPEN_FLAGS.O_RDWR;
    O_CREAT = OPEN_FLAGS.O_CREAT;
    O_EXCL = OPEN_FLAGS.O_EXCL;
    O_NOCTTY = OPEN_FLAGS.O_NOCTTY;
    O_TRUNC = OPEN_FLAGS.O_TRUNC;
    O_APPEND = OPEN_FLAGS.O_APPEND;
    O_DIRECT = OPEN_FLAGS.O_DIRECT;
    O_DIRECTORY = OPEN_FLAGS.O_DIRECTORY;
    O_NOFOLLOW = OPEN_FLAGS.O_NOFOLLOW;
    O_NOATIME = OPEN_FLAGS.O_NOATIME;
    O_CLOEXEC = OPEN_FLAGS.O_CLOEXEC;
    constants = {
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
  }
});

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
function resolveCopyForce(options, context) {
  if (options.mode !== void 0) {
    if (typeof options.mode !== "number" || !Number.isInteger(options.mode) || options.mode < 0) {
      throw new TypeError(`${context}: mode must be a non-negative integer flag.`);
    }
    return (options.mode & COPYFILE_EXCL) === 0;
  }
  if (options.force !== void 0) return options.force;
  return !(options.errorOnExist === true);
}
function eisdirCopyError(source) {
  const error = new Error(`EISDIR: illegal operation on a directory, copy '${source}'`);
  error.code = "ERR_FS_EISDIR";
  error.path = source;
  error.syscall = "cp";
  return error;
}
var QuickJSStats, QuickJSDirent;
var init_internal = __esm({
  "packages/quickjs-shims/src/internal.ts"() {
    "use strict";
    init_src();
    init_host();
    init_constants();
    QuickJSStats = class _QuickJSStats {
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
    QuickJSDirent = class {
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
  }
});

// packages/quickjs-shims/src/buffer.ts
var import_node_buffer, atob, transpile, resolveObjectURL;
var init_buffer = __esm({
  "packages/quickjs-shims/src/buffer.ts"() {
    "use strict";
    init_src();
    import_node_buffer = __toESM(require_node_buffer(), 1);
    init_host();
    init_internal();
    atob = (encoded) => bytesToLatin1(bytesFromHostPayload(encoded));
    transpile = notImplemented("buffer", "transpile");
    resolveObjectURL = notImplemented("buffer", "resolveObjectURL", "blob: URLs are not the realm's");
  }
});

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
async function opFsCopyAsync(source, target, options = {}) {
  return await hostCallAsync("fs.copy", { source, target, recursive: options.recursive ?? false, force: options.force ?? true });
}
async function opFsAppendTextAsync(path, content) {
  return await hostCallAsync("fs.appendText", { path, content });
}
async function opFsReadBytesAsync(path, options = {}) {
  return hostCallBytesAsync("fs.readBytes", { path, ...options });
}
async function opFsWriteBytesAsync(path, bytes, options = {}) {
  return await hostSendBytesAsync("fs.writeBytes", { path, append: options.append ?? false }, bytes);
}
function payloadBytes(data3, encoding) {
  if (data3 instanceof Uint8Array) return data3;
  if (typeof data3 !== "string") return null;
  const normalized = encoding?.toLowerCase();
  if (normalized === void 0 || normalized === "utf8" || normalized === "utf-8") return null;
  return import_node_buffer.Buffer.from(data3, encoding);
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
var init_ops = __esm({
  "packages/quickjs-shims/src/ops.ts"() {
    "use strict";
    init_src();
    init_buffer();
    init_host();
  }
});

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
var createHmac, randomFill, randomFillSync, HOST_RANDOM_CEILING, randomInt, timingSafeEqual, createCipheriv, createDecipheriv, createSign, createVerify, pbkdf2, pbkdf2Sync, scrypt, scryptSync;
var init_crypto = __esm({
  "packages/quickjs-shims/src/crypto.ts"() {
    "use strict";
    init_src();
    init_buffer();
    init_host();
    init_internal();
    init_ops();
    createHmac = notImplemented("crypto", "createHmac", "a host-side HMAC service (the host answers sha1/sha256 digests, not keyed ones)");
    randomFill = notImplemented("crypto", "randomFill", "crypto.randomFill(byteLength) -> bytes");
    randomFillSync = notImplemented("crypto", "randomFillSync", "crypto.randomFill(byteLength) -> bytes");
    HOST_RANDOM_CEILING = 64;
    randomInt = notImplemented("crypto", "randomInt");
    timingSafeEqual = notImplemented("crypto", "timingSafeEqual");
    createCipheriv = notImplemented("crypto", "createCipheriv");
    createDecipheriv = notImplemented("crypto", "createDecipheriv");
    createSign = notImplemented("crypto", "createSign");
    createVerify = notImplemented("crypto", "createVerify");
    pbkdf2 = notImplemented("crypto", "pbkdf2");
    pbkdf2Sync = notImplemented("crypto", "pbkdf2Sync");
    scrypt = notImplemented("crypto", "scrypt");
    scryptSync = notImplemented("crypto", "scryptSync");
  }
});

// packages/quickjs-shims/src/process.ts
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
var cached, process_default;
var init_process = __esm({
  "packages/quickjs-shims/src/process.ts"() {
    "use strict";
    init_src();
    init_host();
    init_internal();
    process_default = createProcessShim();
  }
});

// packages/quickjs-shims/src/index.ts
function installShimGlobals(target = globalThis) {
  const realm = target;
  if (target.process === void 0) target.process = createProcessShim();
  if (target.Buffer === void 0) target.Buffer = import_node_buffer.Buffer;
  if (realm.global === void 0) realm.global = realm;
  if (realm.crypto === void 0) realm.crypto = createCryptoGlobal();
}
var init_src = __esm({
  "packages/quickjs-shims/src/index.ts"() {
    "use strict";
    init_buffer();
    init_crypto();
    init_process();
    init_host();
    init_host();
    installShimGlobals();
  }
});

// artifacts/.node-bundle-meta/classf.host-entry.ts
init_src();

// packages/nodes/classf/src/core.ts
init_src();

// packages/nodes/repacku/dist/core.js
init_src();
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
var IMAGE_EXTENSIONS = DEFAULT_FILE_TYPES.image;
function getFileType(fileName) {
  const extension = getExtension(fileName);
  for (const [type, extensions] of Object.entries(DEFAULT_FILE_TYPES)) {
    if (extensions.includes(extension))
      return type;
  }
  const lower = fileName.toLowerCase();
  if (lower.includes("readme") || lower.includes("license") || lower.includes("changelog"))
    return "text";
  return null;
}
function isFileInTypes(fileName, targetTypes) {
  if (!targetTypes.length)
    return true;
  const fileType = getFileType(fileName);
  if (fileType)
    return targetTypes.includes(fileType);
  const extension = getExtension(fileName);
  return targetTypes.some((type) => DEFAULT_FILE_TYPES[type]?.includes(extension));
}
function isArchiveFile(fileName) {
  return isFileInTypes(fileName, ["archive"]);
}
function selectSinglePackFolderSources(entries) {
  return entries.filter((entry) => entry.isDirectory).sort((left, right) => left.name.localeCompare(right.name, void 0, { numeric: true, sensitivity: "base" }));
}
function getExtension(name) {
  const base = name.split(/[\\/]/).pop() ?? name;
  const index = base.lastIndexOf(".");
  return index > 0 ? base.slice(index).toLowerCase() : "";
}

// packages/nodes/classf/src/blacklist.ts
init_src();

// packages/nodes/samea/dist/core.js
init_src();
var DEFAULT_ARTIST_BLACKLIST = ["pixiv", "twitter", "various", "anthology", "unknown", "trash", "artbook", "\u6C49\u5316", "\u6F2B\u756B", "\u7FFB\u8BD1", "translation"];
var DEFAULT_PATH_BLACKLIST = ["[00\u753B\u5E08\u5206\u7C7B]", "trash", "temp"];
var DEFAULT_ARCHIVE_EXTENSIONS = [".zip", ".rar", ".7z"];
function normalizeSameaInput(input) {
  return {
    action: input.action ?? "plan",
    path: clean(input.path),
    paths: uniqueClean([input.path, ...input.paths ?? [], ...parseList(input.listText)]),
    listText: input.listText ?? "",
    ignorePathBlacklist: input.ignorePathBlacklist ?? false,
    minOccurrences: clampInt(input.minOccurrences, 1, 100, 1),
    centralize: input.centralize ?? false,
    includeDirectories: input.includeDirectories ?? false,
    skipGroupedDirectories: input.skipGroupedDirectories ?? false,
    dryRun: input.dryRun ?? true,
    artistBlacklist: uniqueClean(input.artistBlacklist?.length ? input.artistBlacklist : DEFAULT_ARTIST_BLACKLIST),
    pathBlacklist: uniqueClean(input.pathBlacklist?.length ? input.pathBlacklist : DEFAULT_PATH_BLACKLIST),
    regexBlacklist: uniqueClean(input.regexBlacklist ?? []),
    archiveExtensions: uniqueClean(input.archiveExtensions?.length ? input.archiveExtensions : DEFAULT_ARCHIVE_EXTENSIONS).map((extension) => extension.toLowerCase())
  };
}
async function runSamea(input, runtime, onEvent = () => {
}) {
  const normalized = normalizeSameaInput(input);
  try {
    if (!normalized.paths.length)
      return failure("At least one archive root directory is required.", normalized);
    onEvent({ type: "progress", progress: 15, message: "Scanning SameA archive roots." });
    const planned = await buildSameaPlan(normalized, runtime);
    if (planned.errorCount)
      return { success: false, message: planned.errors[0] ?? "SameA could not build a plan.", data: planned };
    if (normalized.action !== "classify" || normalized.dryRun)
      return success(`SameA planned ${planned.readyCount} archive transfer(s).`, planned);
    onEvent({ type: "progress", progress: 65, message: "Organizing detected artist archives." });
    const applied = [];
    for (const item of planned.items) {
      if (item.status !== "ready") {
        applied.push(item);
        continue;
      }
      try {
        await runtime.ensureDir(runtime.dirname(item.targetPath));
        await runtime.movePath(item.sourcePath, item.targetPath);
        applied.push({ ...item, status: "moved" });
      } catch (error) {
        applied.push({ ...item, status: "error", reason: errorMessage(error) });
      }
    }
    onEvent({ type: "progress", progress: 100, message: "SameA organization completed." });
    const data3 = summarize(normalized, applied, planned.groups, planned.scannedCount);
    return { success: data3.errorCount === 0, message: `SameA organized ${data3.movedCount} archive(s).`, data: data3 };
  } catch (error) {
    return failure(errorMessage(error), normalized);
  }
}
async function buildSameaPlan(input, runtime) {
  const entries = [];
  for (const root of input.paths) {
    const info = await runtime.pathInfo(root);
    if (!info.exists || !info.isDirectory) {
      entries.push({ rootPath: root, entry: { name: runtime.basename(root), path: root, isFile: false, isDirectory: false }, artist: void 0, ignored: "root_not_directory" });
      continue;
    }
    entries.push(...await collectArchives(root, root, input, runtime));
  }
  const counts = /* @__PURE__ */ new Map();
  for (const item of entries)
    if (item.artist && !item.ignored)
      counts.set(item.artist.key, (counts.get(item.artist.key) ?? 0) + 1);
  const groups = buildGroups(entries, counts, input, runtime);
  const items = [];
  for (const item of entries) {
    const sourceName = item.entry.name;
    if (item.ignored) {
      items.push({ rootPath: item.rootPath, sourcePath: item.entry.path, targetPath: item.entry.path, sourceName, artistKey: item.artist?.key ?? "", artistName: item.artist?.label ?? "", status: item.ignored === "root_not_directory" ? "error" : "ignored", reason: item.ignored });
      continue;
    }
    if (!item.artist) {
      items.push({ rootPath: item.rootPath, sourcePath: item.entry.path, targetPath: item.entry.path, sourceName, artistKey: "", artistName: "", status: "ignored", reason: "artist_not_detected" });
      continue;
    }
    const group = groups.find((candidate) => candidate.key === item.artist.key && candidate.targetDir.startsWith(item.rootPath));
    if (!group || group.status !== "ready") {
      items.push({ rootPath: item.rootPath, sourcePath: item.entry.path, targetPath: item.entry.path, sourceName, artistKey: item.artist.key, artistName: item.artist.label, status: "ignored", reason: group?.status === "blacklisted" ? "artist_blacklisted" : "below_min_occurrences" });
      continue;
    }
    const targetPath = runtime.join(group.targetDir, sourceName);
    if (normalizePath(targetPath) === normalizePath(item.entry.path)) {
      items.push({ rootPath: item.rootPath, sourcePath: item.entry.path, targetPath, sourceName, artistKey: item.artist.key, artistName: item.artist.label, status: "skipped", reason: "same_path" });
      continue;
    }
    const target = await runtime.pathInfo(targetPath);
    items.push({ rootPath: item.rootPath, sourcePath: item.entry.path, targetPath, sourceName, artistKey: item.artist.key, artistName: item.artist.label, status: target.exists ? "conflict" : "ready", ...target.exists ? { reason: "target_exists" } : {} });
  }
  return summarize(input, items, groups, entries.filter((entry) => !entry.ignored || entry.ignored !== "root_not_directory").length);
}
async function collectArchives(root, directory, input, runtime) {
  if (!input.ignorePathBlacklist && isPathBlacklisted(directory, input))
    return [];
  const collected = [];
  for (const entry of await runtime.listDir(directory)) {
    if (entry.isDirectory) {
      if (input.skipGroupedDirectories && isArtistGroupDirectory(entry.name))
        continue;
      if (input.includeDirectories) {
        if (!input.ignorePathBlacklist && isPathBlacklisted(entry.path, input)) {
          collected.push({ rootPath: root, entry, artist: void 0, ignored: "path_blacklisted" });
          continue;
        }
        const artist2 = extractArtist(entry.name, input);
        collected.push({ rootPath: root, entry, artist: artist2, ...artist2 && isArtistBlacklisted(artist2.label, input) ? { ignored: "artist_blacklisted" } : {} });
        continue;
      }
      collected.push(...await collectArchives(root, entry.path, input, runtime));
      continue;
    }
    if (!entry.isFile || !isArchive(entry.name, input.archiveExtensions))
      continue;
    if (!input.ignorePathBlacklist && isPathBlacklisted(entry.path, input)) {
      collected.push({ rootPath: root, entry, artist: void 0, ignored: "path_blacklisted" });
      continue;
    }
    const artist = extractArtist(entry.name, input);
    collected.push({ rootPath: root, entry, artist, ...artist && isArtistBlacklisted(artist.label, input) ? { ignored: "artist_blacklisted" } : {} });
  }
  return collected;
}
function buildGroups(entries, counts, input, runtime) {
  const groups = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    if (!entry.artist || groups.has(`${entry.rootPath}\0${entry.artist.key}`))
      continue;
    const count = counts.get(entry.artist.key) ?? 0;
    const base = input.centralize ? runtime.join(entry.rootPath, "[00\u753B\u5E08\u5206\u7C7B]") : entry.rootPath;
    const status = entry.ignored === "artist_blacklisted" ? "blacklisted" : count >= input.minOccurrences ? "ready" : "below_threshold";
    groups.set(`${entry.rootPath}\0${entry.artist.key}`, { key: entry.artist.key, name: entry.artist.label, targetDir: runtime.join(base, entry.artist.label), count, status });
  }
  return [...groups.values()].sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}
function extractArtist(filename, input) {
  const brackets = [...filename.matchAll(/\[([^\[\]]+)\]/g)].map((match) => match[1].trim()).filter(Boolean);
  for (const candidate of brackets) {
    if (isArtistBlacklisted(candidate, input))
      continue;
    const groupArtist = candidate.match(/^(.+?)\s*\(([^()]+)\)$/);
    const group = groupArtist?.[1]?.trim() ?? "";
    const artist = groupArtist?.[2]?.trim() ?? candidate;
    if (!artist || isArtistBlacklisted(artist, input))
      continue;
    const label = group ? `[${group} (${artist})]` : `[${artist}]`;
    return { key: `${group}\0${artist}`.toLowerCase(), label };
  }
  return void 0;
}
function summarize(input, items, groups, scannedCount) {
  const errors = items.filter((item) => item.status === "error" || item.status === "conflict").map((item) => `${item.sourcePath}: ${item.reason ?? item.status}`);
  return {
    action: input.action,
    centralize: input.centralize,
    minOccurrences: input.minOccurrences,
    items,
    groups,
    scannedCount,
    detectedCount: items.filter((item) => item.artistKey).length,
    readyCount: items.filter((item) => item.status === "ready").length,
    movedCount: items.filter((item) => item.status === "moved").length,
    ignoredCount: items.filter((item) => item.status === "ignored").length,
    skippedCount: items.filter((item) => item.status === "skipped").length,
    conflictCount: items.filter((item) => item.status === "conflict").length,
    errorCount: items.filter((item) => item.status === "error").length,
    errors
  };
}
function success(message, data3) {
  return { success: true, message, data: data3 };
}
function failure(message, input) {
  return { success: false, message, data: summarize(input, [{ rootPath: "", sourcePath: "", targetPath: "", sourceName: "", artistKey: "", artistName: "", status: "error", reason: message }], [], 0) };
}
function isArchive(name, extensions) {
  return extensions.some((extension) => name.toLowerCase().endsWith(extension));
}
function isArtistGroupDirectory(name) {
  return /^\[[^\[\]]+\]$/.test(name.trim());
}
function isPathBlacklisted(path, input) {
  return input.pathBlacklist.some((term) => includesLoose(path, term)) || input.regexBlacklist.some((pattern) => matchesRegex(path, pattern));
}
function isArtistBlacklisted(value, input) {
  return input.artistBlacklist.some((term) => includesLoose(value, term)) || input.regexBlacklist.some((pattern) => matchesRegex(value, pattern));
}
function includesLoose(value, term) {
  return Boolean(term) && value.toLocaleLowerCase().includes(term.toLocaleLowerCase());
}
function matchesRegex(value, pattern) {
  try {
    return new RegExp(pattern, "i").test(value);
  } catch {
    return false;
  }
}
function parseList(value) {
  return String(value ?? "").split(/\r?\n|,/).map(clean).filter(Boolean);
}
function uniqueClean(values) {
  return [...new Set(values.map(clean).filter(Boolean))];
}
function clean(value) {
  return String(value ?? "").trim().replace(/^['"]|['"]$/g, "");
}
function normalizePath(path) {
  return path.replace(/\\/g, "/").toLowerCase();
}
function clampInt(value, min, max, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.round(parsed))) : fallback;
}
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

// node_modules/opencc-js/dist/esm/t2cn.js
init_src();
var n = class {
  constructor() {
    this.map = /* @__PURE__ */ new Map();
  }
  addWord(n2, t2) {
    let { map: e2 } = this;
    for (const t3 of n2) {
      const n3 = t3.codePointAt(0), r2 = e2.get(n3);
      if (null == r2) {
        const t4 = /* @__PURE__ */ new Map();
        e2.set(n3, t4), e2 = t4;
      } else e2 = r2;
    }
    e2.trie_val = t2;
  }
  loadDict(n2) {
    if ("string" == typeof n2) {
      n2 = n2.split("|");
      for (const t2 of n2) {
        const [n3, e2] = t2.split(" ");
        if ("string" != typeof e2) throw new TypeError('Invalid dictionary entry: expected string entries to use "source replacement" format.');
        this.addWord(n3, e2);
      }
    } else for (const t2 of n2) {
      if (!Array.isArray(t2) || "string" != typeof t2[0] || "string" != typeof t2[1]) throw new TypeError("Invalid dictionary entry: expected [source, replacement] pairs. If you are passing locale dictionaries to ConverterFactory, spread them, for example: ConverterFactory(...Locale.from.cn, ...Locale.to.hk).");
      const [n3, e2] = t2;
      this.addWord(n3, e2);
    }
  }
  loadDictGroup(n2) {
    n2.slice().reverse().forEach((n3) => {
      this.loadDict(n3);
    });
  }
  matchPrefix(n2, t2) {
    const e2 = n2.length;
    let r2, o2 = this.map, i2 = 0;
    for (let a2 = t2; a2 < e2; ) {
      const t3 = n2.codePointAt(a2);
      a2 += t3 > 65535 ? 2 : 1;
      const e3 = o2.get(t3);
      if (void 0 === e3) break;
      o2 = e3;
      const l2 = o2.trie_val;
      void 0 !== l2 && (i2 = a2, r2 = l2);
    }
    return i2 > 0 ? { end: i2, value: r2 } : null;
  }
  segment(n2) {
    const t2 = n2.length, e2 = [];
    let o2 = null;
    for (let i2 = 0; i2 < t2; ) {
      const t3 = this.matchPrefix(n2, i2);
      t3 ? (null !== o2 && (e2.push(n2.slice(o2, i2)), o2 = null), e2.push(n2.slice(i2, t3.end)), i2 = t3.end) : (null === o2 && (o2 = i2), i2 += r(n2, i2));
    }
    return null !== o2 && e2.push(n2.slice(o2, t2)), e2;
  }
  convert(n2) {
    const t2 = n2.length, e2 = [];
    let o2 = null;
    for (let i2 = 0; i2 < t2; ) {
      const t3 = this.matchPrefix(n2, i2);
      t3 ? (null !== o2 && (e2.push(n2.slice(o2, i2)), o2 = null), e2.push(t3.value), i2 = t3.end) : (null === o2 && (o2 = i2), i2 += r(n2, i2));
    }
    return null !== o2 && e2.push(n2.slice(o2, t2)), e2.join("");
  }
};
function t(n2, t2) {
  return n2.codePointAt(t2) > 65535 ? 2 : 1;
}
function e(n2, r2) {
  const o2 = (function(n3) {
    return n3 >= 12272 && n3 <= 12273 ? 2 : n3 >= 12274 && n3 <= 12275 ? 3 : n3 >= 12276 && n3 <= 12287 ? 2 : 0;
  })(n2.codePointAt(r2));
  if (0 === o2) return 0;
  let i2 = r2 + t(n2, r2);
  for (let r3 = 0; r3 < o2; r3 += 1) {
    if (i2 >= n2.length) return 0;
    i2 = e(n2, i2) || i2 + t(n2, i2);
  }
  return i2;
}
function r(n2, r2) {
  const o2 = e(n2, r2);
  return o2 > r2 ? o2 - r2 : t(n2, r2);
}
function o(...t2) {
  const e2 = (function(n2) {
    return n2.flatMap((n3) => {
      if ((function(n4) {
        return Array.isArray(n4) && n4.every(l);
      })(n3)) return n3;
      if (l(n3)) return [n3];
      if (!Array.isArray(n3)) throw new TypeError("Invalid ConverterFactory argument: expected a dictionary group or locale dictionary collection.");
      const t3 = [];
      let e3 = 0;
      for (; e3 < n3.length && l(n3[e3]); ) t3.push(n3[e3].slice()), e3 += 1;
      const r2 = n3.slice(e3);
      return t3.length > 0 && r2.length > 0 && r2.every(a) ? (t3[t3.length - 1].push(...r2), t3) : [n3];
    });
  })(t2).map((t3) => {
    const e3 = new n();
    return e3.loadDictGroup(t3), e3;
  });
  return function(n2) {
    return e2.reduce((n3, t3) => t3.convert(n3), n2);
  };
}
function i(n2) {
  return Array.isArray(n2) && "string" == typeof n2[0] && "string" == typeof n2[1];
}
function a(n2) {
  return "string" == typeof n2 || Array.isArray(n2) && n2.every(i);
}
function l(n2) {
  return Array.isArray(n2) && n2.every((n3) => (function(n4) {
    return "string" == typeof n4 && ("" === n4 || n4.includes(" "));
  })(n3) || Array.isArray(n3) && n3.every(i));
}
function c(n2) {
  return o([n2]);
}
function s(n2, t2, e2, r2) {
  return { convert: function() {
    !(function t3(o2, i2) {
      if (o2.nodeType !== Node.ELEMENT_NODE || !o2.classList.contains("ignore-opencc")) {
        if (o2.lang === e2 ? (i2 = true, o2.shouldChangeLang = true, o2.lang = r2) : o2.lang && o2.lang.length && (i2 = false), i2) {
          if ("SCRIPT" === o2.tagName) return;
          if ("STYLE" === o2.tagName) return;
          "META" === o2.tagName && "description" === o2.name || "META" === o2.tagName && "keywords" === o2.name ? (null == o2.originalContent && (o2.originalContent = o2.content), o2.content = n2(o2.originalContent)) : "IMG" === o2.tagName ? (null == o2.originalAlt && (o2.originalAlt = o2.alt), o2.alt = n2(o2.originalAlt)) : "INPUT" === o2.tagName && "button" === o2.type && (null == o2.originalValue && (o2.originalValue = o2.value), o2.value = n2(o2.originalValue)), o2.nodeType === Node.ELEMENT_NODE && (o2.hasAttribute("placeholder") && (null == o2.originalPlaceholder && (o2.originalPlaceholder = o2.getAttribute("placeholder")), o2.setAttribute("placeholder", n2(o2.originalPlaceholder))), o2.hasAttribute("aria-label") && (null == o2.originalAriaLabel && (o2.originalAriaLabel = o2.getAttribute("aria-label")), o2.setAttribute("aria-label", n2(o2.originalAriaLabel))));
        }
        for (const e3 of o2.childNodes) e3.nodeType === Node.TEXT_NODE && i2 ? (null == e3.originalString && (e3.originalString = e3.nodeValue), e3.nodeValue = n2(e3.originalString)) : t3(e3, i2);
      }
    })(t2, false);
  }, restore: function() {
    !(function n3(t3) {
      if (t3.nodeType !== Node.ELEMENT_NODE || !t3.classList.contains("ignore-opencc")) {
        t3.shouldChangeLang && (t3.lang = e2), void 0 !== t3.originalString && (t3.nodeValue = t3.originalString), "META" === t3.tagName && "description" === t3.name || "META" === t3.tagName && "keywords" === t3.name ? void 0 !== t3.originalContent && (t3.content = t3.originalContent) : "IMG" === t3.tagName ? void 0 !== t3.originalAlt && (t3.alt = t3.originalAlt) : "INPUT" === t3.tagName && "button" === t3.type && void 0 !== t3.originalValue && (t3.value = t3.originalValue), void 0 !== t3.originalPlaceholder && t3.setAttribute("placeholder", t3.originalPlaceholder), void 0 !== t3.originalAriaLabel && t3.setAttribute("aria-label", t3.originalAriaLabel);
        for (const e3 of t3.childNodes) n3(e3);
      }
    })(t2);
  } };
}
var u = "\u4E00\u53E3\u5403\u500B \u4E00\u53E3\u55AB\u500B|\u4E00\u53E3\u5403\u6210 \u4E00\u53E3\u55AB\u6210|\u4E00\u5BB6\u4E09\u53E3 \u4E00\u5BB6\u4E09\u53E3|\u4E00\u5BB6\u4E94\u53E3 \u4E00\u5BB6\u4E94\u53E3|\u4E00\u5BB6\u516D\u53E3 \u4E00\u5BB6\u516D\u53E3|\u4E00\u5BB6\u56DB\u53E3 \u4E00\u5BB6\u56DB\u53E3|\u4E00\u91DD \u4E00\u91DD|\u4E00\u91DD\u898B\u8840 \u4E00\u91DD\u898B\u8840|\u4E09\u91DD \u4E09\u91DD|\u4E1F\u5DE7\u91DD \u4E1F\u5DE7\u91DD|\u4E39\u7A1C \u4E39\u7A1C|\u4E5D\u91DD \u4E5D\u91DD|\u4E82\u91DD\u7E61 \u4E82\u91DD\u7E61|\u4ED9\u53F0 \u4ED9\u53F0|\u5012\u6263\u91DD\u5152 \u5012\u6263\u91DD\u5152|\u505A\u91DD\u7DDA \u505A\u91DD\u7DDA|\u516B\u5B57\u65B9\u91DD \u516B\u5B57\u65B9\u91DD|\u5200\u5272\u91DD\u624E \u5200\u5272\u91DD\u624E|\u5206\u91DD \u5206\u91DD|\u5225\u91DD \u5225\u91DD|\u523A\u80F3\u91DD \u523A\u80F3\u91DD|\u523A\u91DD \u523A\u91DD|\u5317\u6E2F\u5CF6\u7DAB \u5317\u6E2F\u5CF6\u7DDA|\u5341\u91DD \u5341\u91DD|\u5357\u6E2F\u5CF6\u7DAB \u5357\u6E2F\u5CF6\u7DDA|\u5357\u91DD \u5357\u91DD|\u53CD\u6642\u91DD \u53CD\u6642\u91DD|\u53E3\u5403 \u53E3\u5403|\u53F0\u5C71 \u53F0\u5C71|\u53F0\u5C71\u5E02 \u53F0\u5C71\u5E02|\u53F0\u5DDE \u53F0\u5DDE|\u53F0\u5DDE\u5730\u5340 \u53F0\u5DDE\u5730\u5340|\u53F0\u5DDE\u5E02 \u53F0\u5DDE\u5E02|\u5403\u53E3 \u55AB\u53E3|\u5403\u53E3\u4EE4 \u5403\u53E3\u4EE4|\u5403\u53E3\u98EF \u55AB\u53E3\u98EF|\u5403\u5403 \u55AB\u55AB|\u5403\u5B50 \u55AB\u5B50|\u5411\u98A8\u91DD \u5411\u98A8\u91DD|\u5531\u91DD \u5531\u91DD|\u5544\u91DD\u5152 \u5544\u91DD\u5152|\u55CE\u5561\u91DD \u55CE\u5561\u91DD|\u5927\u653F\u65B9\u91DD \u5927\u653F\u65B9\u91DD|\u5927\u6D77\u6488\u91DD \u5927\u6D77\u6488\u91DD|\u5927\u982D\u91DD \u5927\u982D\u91DD|\u5929\u53F0 \u5929\u53F0|\u5929\u53F0\u5973 \u5929\u53F0\u5973|\u5929\u53F0\u5B97 \u5929\u53F0\u5B97|\u5929\u53F0\u5C71 \u5929\u53F0\u5C71|\u5929\u53F0\u7E23 \u5929\u53F0\u7E23|\u592A\u4E59\u795E\u91DD \u592A\u4E59\u795E\u91DD|\u5947\u53F0 \u5947\u53F0|\u5973\u4EBA\u5FC3\u6D77\u5E95\u91DD \u5973\u4EBA\u5FC3\u6D77\u5E95\u91DD|\u5B9A\u5357\u91DD \u5B9A\u5357\u91DD|\u5B9A\u98A8\u91DD \u5B9A\u98A8\u91DD|\u5C07\u8ECD\u6FB3\u7DAB \u5C07\u8ECD\u6FB3\u7DDA|\u5C0D\u91DD \u5C0D\u91DD|\u5C0F\u91DD \u5C0F\u91DD|\u5C0F\u91DD\u7F8E\u5BB9 \u5C0F\u91DD\u7F8E\u5BB9|\u5C6F\u99AC\u7DAB \u5C6F\u99AC\u7DDA|\u5E73\u91DD\u7E2B \u5E73\u91DD\u7E2B|\u5E7E\u91DD \u5E7E\u91DD|\u5F15\u7DDA\u7A7F\u91DD \u5F15\u7DDA\u7A7F\u91DD|\u5F35\u53E3 \u5F35\u53E3|\u5F35\u67CF\u829D \u5F35\u67CF\u829D|\u5F35\u6822\u829D \u5F35\u6822\u829D|\u5F35\u98DB\u7A7F\u91DD \u5F35\u98DB\u7A7F\u91DD|\u5F37\u5FC3\u91DD \u5F37\u5FC3\u91DD|\u5F3C\u91DD \u5F3C\u91DD|\u5F48\u91DD \u5F48\u91DD|\u61F8\u91DD \u61F8\u91DD|\u61F8\u91DD\u5782\u9732 \u61F8\u91DD\u5782\u9732|\u624B\u8155\u5F0F\u6307\u5317\u91DD \u624B\u8155\u5F0F\u6307\u5317\u91DD|\u624E\u91DD \u624E\u91DD|\u6253\u5B8C\u91DD \u6253\u5B8C\u91DD|\u6253\u91DD \u6253\u91DD|\u62AB\u91DD\u5F62\u8449 \u62AB\u91DD\u5F62\u8449|\u62B5\u91DD \u62B5\u91DD|\u62C8\u91DD\u6307 \u62C8\u91DD\u6307|\u6307\u5317\u91DD \u6307\u5317\u91DD|\u6307\u5357\u91DD \u6307\u5357\u91DD|\u6307\u63EE\u53F0 \u6307\u63EE\u53F0|\u6307\u91DD \u6307\u91DD|\u6307\u91DD\u5F0F \u6307\u91DD\u5F0F|\u63A2\u91DD \u63A2\u91DD|\u63A7\u5236\u53F0 \u63A7\u5236\u53F0|\u63D2\u91DD \u63D2\u91DD|\u6416\u91DD \u6416\u91DD|\u6417\u91DD \u6417\u91DD|\u649E\u91DD \u649E\u91DD|\u64FA\u91DD \u64FA\u91DD|\u6536\u91DD \u6536\u91DD|\u6559\u80B2\u65B9\u91DD \u6559\u80B2\u65B9\u91DD|\u6579\u4E00\u91DD \u6579\u4E00\u91DD|\u65B9\u91DD \u65B9\u91DD|\u6642\u91DD \u6642\u91DD|\u6688\u91DD \u6688\u91DD|\u66F2\u5225\u91DD \u66F2\u5225\u91DD|\u6771\u4E5D\u9F8D\u7DAB \u6771\u4E5D\u9F8D\u7DDA|\u6771\u6D77\u6488\u91DD \u6771\u6D77\u6488\u91DD|\u6771\u6D8C\u7DAB \u6771\u6D8C\u7DDA|\u6771\u9435\u7DAB \u6771\u9435\u7DDA|\u677E\u91DD \u677E\u91DD|\u679D\u91DD \u679D\u91DD|\u6851\u91DD \u6851\u91DD|\u68D2\u91DD \u68D2\u91DD|\u68D2\u91DD\u886B \u68D2\u91DD\u886B|\u68D8\u91DD \u68D8\u91DD|\u68D8\u91DD\u79D1 \u68D8\u91DD\u79D1|\u68D8\u91DD\u9580 \u68D8\u91DD\u9580|\u6A5F\u5834\u5FEB\u7DAB \u6A5F\u5834\u5FEB\u7DDA|\u6B65\u7DDA\u884C\u91DD \u6B65\u7DDA\u884C\u91DD|\u6BD2\u91DD \u6BD2\u91DD|\u6BDB\u7DDA\u91DD \u6BDB\u7DDA\u91DD|\u6BEB\u91DD \u6BEB\u91DD|\u6C34\u5E95\u6488\u91DD \u6C34\u5E95\u6488\u91DD|\u6C99\u4E2D\u7DAB \u6C99\u4E2D\u7DDA|\u6CE8\u5C04\u91DD \u6CE8\u5C04\u91DD|\u6CE8\u5C04\u91DD\u982D \u6CE8\u5C04\u91DD\u982D|\u6D17\u9762\u7682 \u6D17\u9762\u7682|\u6D17\u9AEE\u7682 \u6D17\u9AEE\u7682|\u6D59\u6C5F\u5929\u53F0\u7E23 \u6D59\u6C5F\u5929\u53F0\u7E23|\u6D77\u5E95\u6488\u91DD \u6D77\u5E95\u6488\u91DD|\u6E2F\u5CF6\u7DAB \u6E2F\u5CF6\u7DDA|\u6F0F\u91DD \u6F0F\u91DD|\u70AE\u53F0\u5C71\u5FAA\u9053\u885B\u7406\u4E2D\u5B78 \u70AE\u53F0\u5C71\u5FAA\u9053\u885B\u7406\u4E2D\u5B78|\u7121\u7DDA\u65B0\u805E\u53F0 \u7121\u7DDA\u65B0\u805E\u53F0|\u7121\u91DD\u4E0D\u5F15\u7DDA \u7121\u91DD\u4E0D\u5F15\u7DDA|\u7121\u91DD\u6CE8\u5C04\u5668 \u7121\u91DD\u6CE8\u5C04\u5668|\u71D4\u91DD \u71D4\u91DD|\u7559\u91DD \u7559\u91DD|\u7682\u5316 \u7682\u5316|\u7682\u83A2 \u7682\u83A2|\u7682\u83A2\u6A39 \u7682\u83A2\u6A39|\u7682\u89D2 \u7682\u89D2|\u77ED\u91DD \u77ED\u91DD|\u77F3\u91DD \u77F3\u91DD|\u786C\u80A5\u7682 \u786C\u80A5\u7682|\u78C1\u91DD \u78C1\u91DD|\u78E8\u6775\u6210\u91DD \u78E8\u6775\u6210\u91DD|\u78E8\u91DD\u6EAA \u78E8\u91DD\u6EAA|\u78E8\u9435\u6210\u91DD \u78E8\u9435\u6210\u91DD|\u79D2\u91DD \u79D2\u91DD|\u79E7\u91DD \u79E7\u91DD|\u7A46\u7A1C \u7A46\u7A1C|\u7A7F\u91DD \u7A7F\u91DD|\u7A7F\u91DD\u5F15\u7DDA \u7A7F\u91DD\u5F15\u7DDA|\u7A7F\u91DD\u8D70\u7DDA \u7A7F\u91DD\u8D70\u7DDA|\u7D0B\u5149\u91DD \u7D0B\u5149\u91DD|\u7D30\u91DD\u5BC6\u7E37 \u7D30\u91DD\u5BC6\u7E37|\u7D5E\u5305\u91DD \u7D5E\u5305\u91DD|\u7D66\u500B\u68D2\u9318\u7576\u91DD\u8A8D \u7D66\u500B\u68D2\u9318\u7576\u91DD\u8A8D|\u7D8F\u7A1C \u7D8F\u7A1C|\u7DBF\u88CF\u85CF\u91DD \u7DBF\u88CF\u85CF\u91DD|\u7DBF\u88CF\u91DD \u7DBF\u88CF\u91DD|\u7E2B\u8863\u91DD \u7E2B\u8863\u91DD|\u7E2B\u91DD \u7E2B\u91DD|\u7E2B\u91DD\u88DC\u7DDA \u7E2B\u91DD\u88DC\u7DDA|\u7E2B\u91DD\u8DE1 \u7E2B\u91DD\u8DE1|\u7E3D\u65B9\u91DD \u7E3D\u65B9\u91DD|\u7E43\u91DD \u7E43\u91DD|\u7E61\u82B1\u91DD \u7E61\u82B1\u91DD|\u7E61\u82B1\u91DD\u5152 \u7E61\u82B1\u91DD\u5152|\u7E61\u91DD \u7E61\u91DD|\u7F85\u76E4\u91DD \u7F85\u76E4\u91DD|\u7F8E\u767D\u91DD \u7F8E\u767D\u91DD|\u8033\u91DD \u8033\u91DD|\u80A5\u7682 \u80A5\u7682|\u80A5\u7682\u5287 \u80A5\u7682\u5287|\u80A5\u7682\u6CE1 \u80A5\u7682\u6CE1|\u80A5\u7682\u7C89 \u80A5\u7682\u7C89|\u80A5\u7682\u7D72 \u80A5\u7682\u7D72|\u80A5\u7682\u83A2 \u80A5\u7682\u83A2|\u80C3\u53E3 \u80C3\u53E3|\u80F8\u91DD \u80F8\u91DD|\u81FA\u7063\u53F0 \u81FA\u7063\u53F0|\u8239\u4E0D\u6F0F\u91DD\u6F0F\u91DD\u6C92\u5916\u4EBA \u8239\u4E0D\u6F0F\u91DD\u6F0F\u91DD\u6C92\u5916\u4EBA|\u82B1\u5152\u91DD \u82B1\u5152\u91DD|\u8305\u91DD \u8305\u91DD|\u8343\u7063\u7DAB \u8343\u7063\u7DDA|\u8449\u91DD \u8449\u91DD|\u85CF\u91DD\u7E2B \u85CF\u91DD\u7E2B|\u85E5\u7682 \u85E5\u7682|\u85E5\u91DD \u85E5\u91DD|\u86C7\u53E3\u8702\u91DD \u86C7\u53E3\u8702\u91DD|\u87AB\u91DD \u87AB\u91DD|\u883B\u91DD\u778E\u7078 \u883B\u91DD\u778E\u7078|\u88DC\u8840\u91DD \u88DC\u8840\u91DD|\u88DC\u91DD \u88DC\u91DD|\u898B\u7E2B\u63D2\u91DD \u898B\u7E2B\u63D2\u91DD|\u89C0\u5858\u7DAB \u89C0\u5858\u7DDA|\u8A0E\u91DD\u7DDA \u8A0E\u91DD\u7DDA|\u8C61\u7259\u91DD\u5C16 \u8C61\u7259\u91DD\u5C16|\u8CC0\u723E\u8499\u91DD \u8CC0\u723E\u8499\u91DD|\u8DF3\u91DD \u8DF3\u91DD|\u8E47\u5403 \u8E47\u5403|\u8EDF\u80A5\u7682 \u8EDF\u80A5\u7682|\u8FEA\u58EB\u5C3C\u7DAB \u8FEA\u58EB\u5C3C\u7DDA|\u8FF4\u7D0B\u91DD \u8FF4\u7D0B\u91DD|\u9000\u91DD \u9000\u91DD|\u9006\u6642\u91DD \u9006\u6642\u91DD|\u907F\u96F7\u91DD \u907F\u96F7\u91DD|\u90ED\u53F0\u6210 \u90ED\u53F0\u6210|\u90ED\u53F0\u9298 \u90ED\u53F0\u9298|\u9127\u827E\u5403 \u9127\u827E\u5403|\u91D1\u91DD \u91D1\u91DD|\u91D1\u91DD\u5C71 \u91D1\u91DD\u5C71|\u91D1\u91DD\u5EA6\u4EBA \u91D1\u91DD\u5EA6\u4EBA|\u91D1\u91DD\u82B1 \u91D1\u91DD\u82B1|\u91D1\u91DD\u83C7 \u91D1\u91DD\u83C7|\u91D1\u91DD\u83DC \u91D1\u91DD\u83DC|\u91D8\u66F8\u91DD \u91D8\u66F8\u91DD|\u91DD\u5177 \u91DD\u5177|\u91DD\u523A \u91DD\u523A|\u91DD\u523A\u9EBB\u9189 \u91DD\u523A\u9EBB\u9189|\u91DD\u5291 \u91DD\u5291|\u91DD\u5B54 \u91DD\u5B54|\u91DD\u5B54\u651D\u5F71\u6A5F \u91DD\u5B54\u651D\u5F71\u6A5F|\u91DD\u5B54\u7167\u50CF \u91DD\u5B54\u7167\u50CF|\u91DD\u5B54\u7167\u50CF\u6A5F \u91DD\u5B54\u7167\u50CF\u6A5F|\u91DD\u5B54\u73FE\u8C61 \u91DD\u5B54\u73FE\u8C61|\u91DD\u5C0D \u91DD\u5C0D|\u91DD\u5C0D\u6027 \u91DD\u5C0D\u6027|\u91DD\u5C0D\u65BC \u91DD\u5C0D\u65BC|\u91DD\u5C16 \u91DD\u5C16|\u91DD\u5C16\u5152 \u91DD\u5C16\u5152|\u91DD\u5DE5 \u91DD\u5DE5|\u91DD\u5E03 \u91DD\u5E03|\u91DD\u5F62\u8449 \u91DD\u5F62\u8449|\u91DD\u6307 \u91DD\u6307|\u91DD\u6311\u5200\u6316 \u91DD\u6311\u5200\u6316|\u91DD\u68B3\u6A5F \u91DD\u68B3\u6A5F|\u91DD\u6C08 \u91DD\u6C08|\u91DD\u6CD5 \u91DD\u6CD5|\u91DD\u7099 \u91DD\u7099|\u91DD\u72C0 \u91DD\u72C0|\u91DD\u72C0\u7269 \u91DD\u72C0\u7269|\u91DD\u76E4 \u91DD\u76E4|\u91DD\u773C \u91DD\u773C|\u91DD\u773C\u5B50 \u91DD\u773C\u5B50|\u91DD\u795E \u91DD\u795E|\u91DD\u7B46 \u91DD\u7B46|\u91DD\u7B46\u5320 \u91DD\u7B46\u5320|\u91DD\u7B52 \u91DD\u7B52|\u91DD\u7B8D \u91DD\u7B8D|\u91DD\u7B8D\u5152 \u91DD\u7B8D\u5152|\u91DD\u7DDA \u91DD\u7DDA|\u91DD\u7DDA\u5305 \u91DD\u7DDA\u5305|\u91DD\u7DDA\u5A18 \u91DD\u7DDA\u5A18|\u91DD\u7DDA\u6D3B \u91DD\u7DDA\u6D3B|\u91DD\u7DDA\u6D3B\u8A08 \u91DD\u7DDA\u6D3B\u8A08|\u91DD\u7DDA\u76D2 \u91DD\u7DDA\u76D2|\u91DD\u7DDA\u7B94\u7C6C \u91DD\u7DDA\u7B94\u7C6C|\u91DD\u7E54 \u91DD\u7E54|\u91DD\u7E54\u54C1 \u91DD\u7E54\u54C1|\u91DD\u7E54\u5EE0 \u91DD\u7E54\u5EE0|\u91DD\u7E54\u6599 \u91DD\u7E54\u6599|\u91DD\u8173 \u91DD\u8173|\u91DD\u8449 \u91DD\u8449|\u91DD\u8449\u6797 \u91DD\u8449\u6797|\u91DD\u8449\u690D\u7269 \u91DD\u8449\u690D\u7269|\u91DD\u8449\u6A39 \u91DD\u8449\u6A39|\u91DD\u91DD\u898B\u8840 \u91DD\u91DD\u898B\u8840|\u91DD\u91E6 \u91DD\u91E6|\u91DD\u92D2 \u91DD\u92D2|\u91DD\u92D2\u76F8\u5C0D \u91DD\u92D2\u76F8\u5C0D|\u91DD\u92D2\u76F8\u6295 \u91DD\u92D2\u76F8\u6295|\u91DD\u92E9 \u91DD\u92E9|\u91DD\u982D \u91DD\u982D|\u91DD\u990C\u83AB\u6E1B \u91DD\u990C\u83AB\u6E1B|\u91DD\u9AA8 \u91DD\u9AA8|\u91DD\u9B5A \u91DD\u9B5A|\u91DD\u9EF9 \u91DD\u9EF9|\u91DD\u9EF9\u7D21\u7E3E \u91DD\u9EF9\u7D21\u7E3E|\u91DD\u9F34 \u91DD\u9F34|\u91DD\u9F3B \u91DD\u9F3B|\u91DD\u9F3B\u5152 \u91DD\u9F3B\u5152|\u91E6\u91DD \u91E6\u91DD|\u9264\u91DD \u9264\u91DD|\u9280\u91DD \u9280\u91DD|\u92FC\u91DD \u92FC\u91DD|\u9336\u91DD \u9336\u91DD|\u9435\u91DD \u9435\u91DD|\u9577\u91DD \u9577\u91DD|\u958B\u53E3 \u958B\u53E3|\u9632\u75AB\u91DD \u9632\u75AB\u91DD|\u96FB\u5531\u91DD \u96FB\u5531\u91DD|\u96FB\u91DD \u96FB\u91DD|\u96FB\u91DD\u9EBB\u9189 \u96FB\u91DD\u9EBB\u9189|\u9762\u7682 \u9762\u7682|\u9802\u91DD \u9802\u91DD|\u9802\u91DD\u5152 \u9802\u91DD\u5152|\u9802\u91DD\u6371\u4F4F \u9802\u91DD\u6371\u4F4F|\u9802\u9580\u91DD \u9802\u9580\u91DD|\u9806\u6642\u91DD \u9806\u6642\u91DD|\u9810\u9632\u91DD \u9810\u9632\u91DD|\u9818\u5E36\u91DD \u9818\u5E36\u91DD|\u98A8\u5411\u91DD \u98A8\u5411\u91DD|\u98DB\u91DD\u8D70\u7DDA \u98DB\u91DD\u8D70\u7DDA|\u9999\u7682 \u9999\u7682|\u9AA8\u91DD \u9AA8\u91DD|\u9AEE\u91DD \u9AEE\u91DD|\u9B3C\u91DD\u8349 \u9B3C\u91DD\u8349|\u9CF3\u53F0 \u9CF3\u53F0|\u9E7D\u6C34\u91DD \u9E7D\u6C34\u91DD|\u9EBB\u9189\u91DD \u9EBB\u9189\u91DD|\u9EC3\u6210 \u9EC3\u6210|\u9F3B\u91DD\u7642\u6CD5 \u9F3B\u91DD\u7642\u6CD5|\u9F67\u8617\u541E\u91DD \u9F67\u8617\u541E\u91DD|\u9F8D\u61C9\u53F0 \u9F8D\u61C9\u53F0";
var g = "\u507D \u50DE|\u5151 \u514C|\u5367 \u81E5|\u53C1 \u53C4|\u53F0 \u81FA|\u5403 \u55AB|\u5507 \u8123|\u555F \u5553|\u56F1 \u56EA|\u5AAA \u5ABC|\u5AAF \u5B00|\u60A6 \u6085|\u6120 \u614D|\u6237 \u6236|\u635D \u6329|\u63FE \u6435|\u654D \u6558|\u655A \u6553|\u67B1 \u6AAF|\u67B4 \u67FA|\u68C1 \u68B2|\u6985 \u69B2|\u6C32 \u6C33|\u6D9A \u6D97|\u6E29 \u6EAB|\u6E88 \u6F59|\u6F40 \u6F68|\u6FD5 \u6EBC|\u7076 \u7AC8|\u70BA \u7232|\u7174 \u7185|\u75F4 \u7661|\u7682 \u7681|\u773E \u8846|\u79D8 \u7955|\u7A0E \u7A05|\u7A1C \u68F1|\u7CA7 \u599D|\u7CBD \u7CC9|\u7CED \u7CC9|\u7DAB \u7DDA|\u7DFC \u7E15|\u7F3D \u9262|\u8131 \u812B|\u817D \u8183|\u8471 \u8525|\u8480 \u8495|\u848D \u853F|\u85F4 \u860A|\u8715 \u86FB|\u885E \u885B|\u8879 \u53EA|\u8AAC \u8AAA|\u8E34 \u8E0A|\u8F3C \u8F40|\u9196 \u919E|\u91DD \u937C|\u920E \u9264|\u92ED \u92B3|\u95B2 \u95B1|\u9C1B \u9C2E";
var f = "\u4F0A\u5229\u8AFE \u4F0A\u5229\u8AFE\u4F0A|\u4F0A\u5229\u8AFE\u5DDE \u4F0A\u5229\u8AFE\u4F0A\u5DDE|\u4F3A\u670D\u5668 \u670D\u52D9\u5668|\u4F5C\u696D\u7CFB\u7D71 \u64CD\u4F5C\u7CFB\u7D71|\u5317\u5361\u7F85\u840A\u7D0D \u5317\u5361\u7F85\u4F86\u7D0D|\u5317\u5361\u7F85\u840A\u7D0D\u5DDE \u5317\u5361\u7F85\u4F86\u7D0D\u5DDE|\u5357\u5361\u7F85\u840A\u7D0D \u5357\u5361\u7F85\u4F86\u7D0D|\u5357\u5361\u7F85\u840A\u7D0D\u5DDE \u5357\u5361\u7F85\u4F86\u7D0D\u5DDE|\u5967\u514B\u62C9\u8377\u99AC \u4FC4\u514B\u62C9\u4F55\u99AC|\u5967\u514B\u62C9\u8377\u99AC\u5DDE \u4FC4\u514B\u62C9\u4F55\u99AC\u5DDE|\u5BC6\u829D\u6839 \u5BC6\u6B47\u6839|\u5BC6\u829D\u6839\u5DDE \u5BC6\u6B47\u6839\u5DDE|\u5BEC\u983B \u5BEC\u5E36|\u5FB7\u85A9\u65AF \u5F97\u514B\u85A9\u65AF|\u5FB7\u85A9\u65AF\u5DDE \u5F97\u514B\u85A9\u65AF\u5DDE|\u641C\u5C0B \u641C\u7D22|\u68B3\u8299\u5398 \u8212\u8299\u857E|\u6982\u7387 \u6982\u7387|\u6A5F\u6703\u7387 \u6982\u7387|\u6A5F\u7387 \u5E7E\u7387|\u6E38\u6A19 \u5149\u6A19|\u6ED1\u9F20 \u9F20\u6A19|\u786C\u789F \u786C\u76E4|\u79C1\u96B1\u6B0A \u96B1\u79C1\u6B0A|\u7A0B\u5F0F\u8A9E\u8A00 \u7DE8\u7A0B\u8A9E\u8A00|\u7DAD\u73CD\u5C3C\u4E9E \u5F17\u5409\u5C3C\u4E9E|\u7DAD\u73CD\u5C3C\u4E9E\u5DDE \u5F17\u5409\u5C3C\u4E9E\u5DDE|\u7F85\u5FB7\u5CF6 \u7F85\u5F97\u5CF6|\u7F85\u5FB7\u5CF6\u5DDE \u7F85\u5F97\u5CF6\u5DDE|\u897F\u7DAD\u73CD\u5C3C\u4E9E \u897F\u5F17\u5409\u5C3C\u4E9E|\u897F\u7DAD\u73CD\u5C3C\u4E9E\u5DDE \u897F\u5F17\u5409\u5C3C\u4E9E\u5DDE|\u8CC7\u6599\u593E \u6587\u4EF6\u593E|\u8CD3\u5915\u51E1\u5C3C\u4E9E \u8CD3\u5915\u6CD5\u5C3C\u4E9E|\u8CD3\u5915\u51E1\u5C3C\u4E9E\u5DDE \u8CD3\u5915\u6CD5\u5C3C\u4E9E\u5DDE|\u99AC\u5229\u862D \u99AC\u91CC\u862D|\u99AC\u5229\u862D\u5DDE \u99AC\u91CC\u862D\u5DDE";
var d = "\u4E00\u53E3\u5403\u500B \u4E00\u53E3\u55AB\u500B|\u4E00\u53E3\u5403\u6210 \u4E00\u53E3\u55AB\u6210|\u4E00\u5BB6\u4E09\u53E3 \u4E00\u5BB6\u4E09\u53E3|\u4E00\u5BB6\u4E94\u53E3 \u4E00\u5BB6\u4E94\u53E3|\u4E00\u5BB6\u516D\u53E3 \u4E00\u5BB6\u516D\u53E3|\u4E00\u5BB6\u56DB\u53E3 \u4E00\u5BB6\u56DB\u53E3|\u4E00\u5C55\u9577\u624D \u4E00\u5C55\u9577\u624D|\u4E00\u6D41\u4EBA\u624D \u4E00\u6D41\u4EBA\u624D|\u4E00\u8868\u4EBA\u624D \u4E00\u8868\u4EBA\u624D|\u4E00\u91DD \u4E00\u91DD|\u4E00\u91DD\u898B\u8840 \u4E00\u91DD\u898B\u8840|\u4E03\u6B65\u4E4B\u624D \u4E03\u6B65\u4E4B\u624D|\u4E03\u6B65\u5947\u624D \u4E03\u6B65\u5947\u624D|\u4E09\u624D \u4E09\u624D|\u4E09\u624D\u5716\u6703 \u4E09\u624D\u5716\u6703|\u4E09\u91DD \u4E09\u91DD|\u4E0B\u624D \u4E0B\u624D|\u4E0D\u6210\u624D \u4E0D\u6210\u624D|\u4E0D\u624D \u4E0D\u624D|\u4E0D\u6253\u4E0D\u6210\u624D \u4E0D\u6253\u4E0D\u6210\u624D|\u4E0D\u826F\u624D \u4E0D\u826F\u624D|\u4E1F\u5DE7\u91DD \u4E1F\u5DE7\u91DD|\u4E2D\u624D \u4E2D\u624D|\u4E2D\u6838 \u4E2D\u6838|\u4E39\u7A1C \u4E39\u7A1C|\u4E4B\u6838 \u4E4B\u6838|\u4E5D\u91DD \u4E5D\u91DD|\u4E7E\u5974\u624D \u4E7E\u5974\u624D|\u4E82\u91DD\u7E61 \u4E82\u91DD\u7E61|\u4E8C\u6D41\u4EBA\u624D \u4E8C\u6D41\u4EBA\u624D|\u4E9E\u6838 \u4E9E\u6838|\u4EBA\u624D \u4EBA\u624D|\u4EBA\u624D\u51FA\u8846 \u4EBA\u624D\u51FA\u8846|\u4EBA\u624D\u5916\u6D41 \u4EBA\u624D\u5916\u6D41|\u4EBA\u624D\u5EAB \u4EBA\u624D\u5EAB|\u4EBA\u624D\u6D41\u5931 \u4EBA\u624D\u6D41\u5931|\u4EBA\u624D\u6FDF\u6FDF \u4EBA\u624D\u6FDF\u6FDF|\u4EBA\u624D\u8F29\u51FA \u4EBA\u624D\u8F29\u51FA|\u4EBA\u624D\u96E3\u5F97 \u4EBA\u624D\u96E3\u5F97|\u4EBA\u76E1\u5176\u624D \u4EBA\u76E1\u5176\u624D|\u4ED9\u624D \u4ED9\u624D|\u4F0A\u6838 \u4F0A\u6838|\u4F5C\u80B2\u82F1\u624D \u4F5C\u80B2\u82F1\u624D|\u4F73\u4EBA\u624D\u5B50 \u4F73\u4EBA\u624D\u5B50|\u500B\u6838 \u500B\u6838|\u5012\u4E86\u6838\u6843\u8ECA\u5B50 \u5012\u4E86\u6838\u6843\u8ECA\u5B50|\u5012\u6263\u91DD\u5152 \u5012\u6263\u91DD\u5152|\u504F\u624D \u504F\u624D|\u505A\u91DD\u7DDA \u505A\u91DD\u7DDA|\u50B2\u4E16\u8F15\u624D \u50B2\u4E16\u8F15\u624D|\u50C5\u4F5C\u53C3\u8003 \u50C5\u4F5C\u53C3\u8003|\u50C5\u4F9B\u53C3\u8003 \u50C5\u4F9B\u53C3\u8003|\u5132\u8A13\u4EBA\u624D \u5132\u8A13\u4EBA\u624D|\u514D\u53C3 \u514D\u53C3|\u5167\u53C3 \u5167\u53C3|\u5167\u6838 \u5167\u6838|\u5168\u624D \u5168\u624D|\u5168\u7A0B\u53C3\u52A0 \u5168\u7A0B\u53C3\u52A0|\u5168\u9762\u7981\u6B62\u6838\u8A66\u9A57\u689D\u7D04 \u5168\u9762\u7981\u6B62\u6838\u8A66\u9A57\u689D\u7D04|\u516B\u5B57\u65B9\u91DD \u516B\u5B57\u65B9\u91DD|\u516B\u6597\u4E4B\u624D \u516B\u6597\u4E4B\u624D|\u516B\u6597\u624D \u516B\u6597\u624D|\u516C\u624D\u516C\u671B \u516C\u624D\u516C\u671B|\u516C\u8846\u53C3\u8207 \u516C\u8846\u53C3\u8207|\u516D\u624D\u5B50\u66F8 \u516D\u624D\u5B50\u66F8|\u5176\u6838 \u5176\u6838|\u51A0\u4E16\u4E4B\u624D \u51A0\u4E16\u4E4B\u624D|\u51B0\u6838 \u51B0\u6838|\u51E0\u6848\u4E4B\u624D \u51E0\u6848\u4E4B\u624D|\u51E1\u624D \u51E1\u624D|\u51FA\u502B\u4E4B\u624D \u51FA\u502B\u4E4B\u624D|\u5200\u5272\u91DD\u624E \u5200\u5272\u91DD\u624E|\u5206\u91DD \u5206\u91DD|\u521D\u9732\u624D\u83EF \u521D\u9732\u624D\u83EF|\u5225\u91DD \u5225\u91DD|\u5229\u5F0A\u53C3\u534A \u5229\u5F0A\u53C3\u534A|\u523A\u80F3\u91DD \u523A\u80F3\u91DD|\u523A\u91DD \u523A\u91DD|\u524B\u6838 \u524B\u6838|\u524D\u6838 \u524D\u6838|\u529B\u8584\u624D\u758F \u529B\u8584\u624D\u758F|\u529F\u904E\u53C3\u534A \u529F\u904E\u53C3\u534A|\u52D5\u5982\u53C3\u5546 \u52D5\u5982\u53C3\u5546|\u5321\u6FDF\u4E4B\u624D \u5321\u6FDF\u4E4B\u624D|\u5341\u91DD \u5341\u91DD|\u5343\u5678\u7D1A\u6838\u6B66\u5668 \u5343\u5678\u7D1A\u6838\u6B66\u5668|\u5357\u91DD \u5357\u91DD|\u535A\u5B78\u591A\u624D \u535A\u5B78\u591A\u624D|\u536F\u9149\u53C3\u8FB0 \u536F\u9149\u53C3\u8FB0|\u5370\u6838 \u5370\u6838|\u5375\u6838 \u5375\u6838|\u539F\u5B50\u6838 \u539F\u5B50\u6838|\u539F\u6838 \u539F\u6838|\u53BB\u6838 \u53BB\u6838|\u53C3\u4E88 \u53C3\u4E88|\u53C3\u4E8B \u53C3\u4E8B|\u53C3\u4F0D \u53C3\u4F0D|\u53C3\u4F50 \u53C3\u4F50|\u53C3\u5047 \u53C3\u5047|\u53C3\u5169\u9662 \u53C3\u5169\u9662|\u53C3\u524D\u843D\u5F8C \u53C3\u524D\u843D\u5F8C|\u53C3\u52A0 \u53C3\u52A0|\u53C3\u52A0\u4EBA \u53C3\u52A0\u4EBA|\u53C3\u52A0\u570B \u53C3\u52A0\u570B|\u53C3\u52A0\u5B8C \u53C3\u52A0\u5B8C|\u53C3\u52A0\u7232 \u53C3\u52A0\u7232|\u53C3\u52A0\u734E \u53C3\u52A0\u734E|\u53C3\u52A0\u8005 \u53C3\u52A0\u8005|\u53C3\u52BE \u53C3\u52BE|\u53C3\u534A \u53C3\u534A|\u53C3\u5408 \u53C3\u5408|\u53C3\u540C\u5951 \u53C3\u540C\u5951|\u53C3\u5546 \u53C3\u5546|\u53C3\u5718 \u53C3\u5718|\u53C3\u5802 \u53C3\u5802|\u53C3\u5834 \u53C3\u5834|\u53C3\u5929 \u53C3\u5929|\u53C3\u594F \u53C3\u594F|\u53C3\u5B6B \u53C3\u5B6B|\u53C3\u5BBF \u53C3\u5BBF|\u53C3\u5BBF\u4E03 \u53C3\u5BBF\u4E03|\u53C3\u5C07 \u53C3\u5C07|\u53C3\u5C55 \u53C3\u5C55|\u53C3\u5C55\u5546 \u53C3\u5C55\u5546|\u53C3\u5C55\u5718 \u53C3\u5C55\u5718|\u53C3\u5DEE \u53C3\u5DEE|\u53C3\u5DEE\u4E0D\u9F4A \u53C3\u5DEE\u4E0D\u9F4A|\u53C3\u5DEE\u932F\u843D \u53C3\u5DEE\u932F\u843D|\u53C3\u5EA6 \u53C3\u5EA6|\u53C3\u609F \u53C3\u609F|\u53C3\u6230 \u53C3\u6230|\u53C3\u6230\u570B \u53C3\u6230\u570B|\u53C3\u62DC \u53C3\u62DC|\u53C3\u62FE\u58F9 \u53C3\u62FE\u58F9|\u53C3\u62FE\u9678 \u53C3\u62FE\u9678|\u53C3\u653F \u53C3\u653F|\u53C3\u653F\u6B0A \u53C3\u653F\u6B0A|\u53C3\u6578 \u53C3\u6578|\u53C3\u6578\u8868 \u53C3\u6578\u8868|\u53C3\u6703 \u53C3\u6703|\u53C3\u671D \u53C3\u671D|\u53C3\u672C \u53C3\u672C|\u53C3\u6821 \u53C3\u6821|\u53C3\u6F14 \u53C3\u6F14|\u53C3\u7167 \u53C3\u7167|\u53C3\u7167\u5361 \u53C3\u7167\u5361|\u53C3\u7167\u7269 \u53C3\u7167\u7269|\u53C3\u7167\u7CFB \u53C3\u7167\u7CFB|\u53C3\u770B \u53C3\u770B|\u53C3\u77E5\u653F\u4E8B \u53C3\u77E5\u653F\u4E8B|\u53C3\u7834 \u53C3\u7834|\u53C3\u79AA \u53C3\u79AA|\u53C3\u7D9C \u53C3\u7D9C|\u53C3\u8003 \u53C3\u8003|\u53C3\u8003\u503C \u53C3\u8003\u503C|\u53C3\u8003\u50F9 \u53C3\u8003\u50F9|\u53C3\u8003\u50F9\u503C \u53C3\u8003\u50F9\u503C|\u53C3\u8003\u53C3\u8003 \u53C3\u8003\u53C3\u8003|\u53C3\u8003\u5EA7\u6A19 \u53C3\u8003\u5EA7\u6A19|\u53C3\u8003\u6027 \u53C3\u8003\u6027|\u53C3\u8003\u624B\u518A \u53C3\u8003\u624B\u518A|\u53C3\u8003\u6587\u737B \u53C3\u8003\u6587\u737B|\u53C3\u8003\u66F8 \u53C3\u8003\u66F8|\u53C3\u8003\u66F8\u76EE \u53C3\u8003\u66F8\u76EE|\u53C3\u8003\u6750\u6599 \u53C3\u8003\u6750\u6599|\u53C3\u8003\u6CD5 \u53C3\u8003\u6CD5|\u53C3\u8003\u6D88\u606F \u53C3\u8003\u6D88\u606F|\u53C3\u8003\u7279\u85CF \u53C3\u8003\u7279\u85CF|\u53C3\u8003\u7CFB \u53C3\u8003\u7CFB|\u53C3\u8003\u8CC7\u6599 \u53C3\u8003\u8CC7\u6599|\u53C3\u80A1 \u53C3\u80A1|\u53C3\u8207 \u53C3\u8207|\u53C3\u8207\u4EBA\u54E1 \u53C3\u8207\u4EBA\u54E1|\u53C3\u8207\u5236 \u53C3\u8207\u5236|\u53C3\u8207\u5EA6 \u53C3\u8207\u5EA6|\u53C3\u8207\u611F \u53C3\u8207\u611F|\u53C3\u8207\u6B0A \u53C3\u8207\u6B0A|\u53C3\u8207\u7387 \u53C3\u8207\u7387|\u53C3\u8207\u8005 \u53C3\u8207\u8005|\u53C3\u8846\u5169\u9662 \u53C3\u8846\u5169\u9662|\u53C3\u898B \u53C3\u898B|\u53C3\u898B\u4E92\u7167 \u53C3\u898B\u4E92\u7167|\u53C3\u898B\u6CE8 \u53C3\u898B\u6CE8|\u53C3\u89C0 \u53C3\u89C0|\u53C3\u89C0\u5238 \u53C3\u89C0\u5238|\u53C3\u89C0\u53C3\u89C0 \u53C3\u89C0\u53C3\u89C0|\u53C3\u89C0\u5718 \u53C3\u89C0\u5718|\u53C3\u89C0\u5718\u9AD4 \u53C3\u89C0\u5718\u9AD4|\u53C3\u89C0\u5B8C \u53C3\u89C0\u5B8C|\u53C3\u89C0\u8005 \u53C3\u89C0\u8005|\u53C3\u8A02 \u53C3\u8A02|\u53C3\u8A13 \u53C3\u8A13|\u53C3\u8A2A \u53C3\u8A2A|\u53C3\u8A2A\u5718 \u53C3\u8A2A\u5718|\u53C3\u8A55 \u53C3\u8A55|\u53C3\u8A71\u982D \u53C3\u8A71\u982D|\u53C3\u8ACB \u53C3\u8ACB|\u53C3\u8B00 \u53C3\u8B00|\u53C3\u8B00\u7E3D\u90E8 \u53C3\u8B00\u7E3D\u90E8|\u53C3\u8B00\u7E3D\u9577 \u53C3\u8B00\u7E3D\u9577|\u53C3\u8B00\u9577 \u53C3\u8B00\u9577|\u53C3\u8B01 \u53C3\u8B01|\u53C3\u8B5A \u53C3\u8B5A|\u53C3\u8B70 \u53C3\u8B70|\u53C3\u8B70\u54E1 \u53C3\u8B70\u54E1|\u53C3\u8B70\u6703 \u53C3\u8B70\u6703|\u53C3\u8B70\u9662 \u53C3\u8B70\u9662|\u53C3\u8CFD \u53C3\u8CFD|\u53C3\u8CFD\u570B \u53C3\u8CFD\u570B|\u53C3\u8CFD\u6B0A \u53C3\u8CFD\u6B0A|\u53C3\u8CFD\u7247 \u53C3\u8CFD\u7247|\u53C3\u8CFD\u8005 \u53C3\u8CFD\u8005|\u53C3\u8D0A \u53C3\u8D0A|\u53C3\u8ECD \u53C3\u8ECD|\u53C3\u8FB0 \u53C3\u8FB0|\u53C3\u8FB0\u536F\u9149 \u53C3\u8FB0\u536F\u9149|\u53C3\u8FB0\u65E5\u6708 \u53C3\u8FB0\u65E5\u6708|\u53C3\u900F \u53C3\u900F|\u53C3\u9053 \u53C3\u9053|\u53C3\u9078 \u53C3\u9078|\u53C3\u9078\u4EBA \u53C3\u9078\u4EBA|\u53C3\u914C \u53C3\u914C|\u53C3\u91CF \u53C3\u91CF|\u53C3\u91CF\u7A7A\u9593 \u53C3\u91CF\u7A7A\u9593|\u53C3\u932F \u53C3\u932F|\u53C3\u95B1 \u53C3\u95B1|\u53C3\u9662 \u53C3\u9662|\u53C3\u96DC \u53C3\u96DC|\u53C3\u9748 \u53C3\u9748|\u53C3\u9769 \u53C3\u9769|\u53C3\u9810 \u53C3\u9810|\u53C3\u982D \u53C3\u982D|\u53C3\u9A57 \u53C3\u9A57|\u53CD\u6642\u91DD \u53CD\u6642\u91DD|\u53CD\u6838 \u53CD\u6838|\u53D6\u624D \u53D6\u624D|\u53E3\u5403 \u53E3\u5403|\u53E3\u624D \u53E3\u624D|\u53E3\u624D\u597D \u53E3\u624D\u597D|\u53E3\u624D\u8FA8\u7D66 \u53E3\u624D\u8FA8\u7D66|\u53EF\u4F9B\u53C3\u8003 \u53EF\u4F9B\u53C3\u8003|\u53EF\u618E\u624D \u53EF\u618E\u624D|\u5403\u53E3 \u55AB\u53E3|\u5403\u53E3\u4EE4 \u5403\u53E3\u4EE4|\u5403\u53E3\u98EF \u55AB\u53E3\u98EF|\u5403\u5403 \u55AB\u55AB|\u5403\u5B50 \u55AB\u5B50|\u5408\u8457 \u5408\u8457|\u5408\u8457\u8005 \u5408\u8457\u8005|\u540C\u53C3 \u540C\u53C3|\u540D\u8457 \u540D\u8457|\u5411\u98A8\u91DD \u5411\u98A8\u91DD|\u547D\u4E16\u4E4B\u624D \u547D\u4E16\u4E4B\u624D|\u547D\u4E16\u624D \u547D\u4E16\u624D|\u548C\u6838 \u548C\u6838|\u5510\u624D\u5E38 \u5510\u624D\u5E38|\u5531\u91DD \u5531\u91DD|\u5544\u91DD\u5152 \u5544\u91DD\u5152|\u5584\u624D \u5584\u624D|\u5584\u624D\u7AE5\u5B50 \u5584\u624D\u7AE5\u5B50|\u559C\u6182\u53C3\u534A \u559C\u6182\u53C3\u534A|\u559D\u53C3 \u559D\u53C3|\u55AB\u6572\u624D \u55AB\u6572\u624D|\u55AC\u624D \u55AC\u624D|\u55AE\u6838 \u55AE\u6838|\u55AE\u6838\u7D30\u80DE\u589E\u591A\u75C7 \u55AE\u6838\u7D30\u80DE\u589E\u591A\u75C7|\u55CE\u5561\u91DD \u55CE\u5561\u91DD|\u56DB\u624D\u5B50 \u56DB\u624D\u5B50|\u56DB\u6838 \u56DB\u6838|\u571F\u53C3 \u571F\u53C3|\u5730\u6838 \u5730\u6838|\u5730\u9762\u6838\u7206\u70B8 \u5730\u9762\u6838\u7206\u70B8|\u57CB\u6C92\u4EBA\u624D \u57CB\u6C92\u4EBA\u624D|\u589E\u91CF\u53C3\u6578 \u589E\u91CF\u53C3\u6578|\u5916\u624D \u5916\u624D|\u5916\u6838 \u5916\u6838|\u591A\u4E8B\u901E\u624D \u591A\u4E8B\u901E\u624D|\u591A\u624D \u591A\u624D|\u591A\u624D\u591A\u85DD \u591A\u624D\u591A\u85DD|\u591A\u6838 \u591A\u6838|\u5927\u624D \u5927\u624D|\u5927\u624D\u5C0F\u7528 \u5927\u624D\u5C0F\u7528|\u5927\u624D\u69C3\u69C3 \u5927\u624D\u69C3\u69C3|\u5927\u653F\u65B9\u91DD \u5927\u653F\u65B9\u91DD|\u5927\u66C6\u5341\u624D\u5B50 \u5927\u66C6\u5341\u624D\u5B50|\u5927\u6838 \u5927\u6838|\u5927\u6D77\u6488\u91DD \u5927\u6D77\u6488\u91DD|\u5927\u982D\u91DD \u5927\u982D\u91DD|\u5929\u5992\u82F1\u624D \u5929\u5992\u82F1\u624D|\u5929\u624D \u5929\u624D|\u5929\u624D\u5152\u7AE5 \u5929\u624D\u5152\u7AE5|\u5929\u624D\u51FA\u81EA\u52E4\u596E \u5929\u624D\u51FA\u81EA\u52E4\u596E|\u5929\u624D\u578B \u5929\u624D\u578B|\u5929\u624D\u6559\u80B2 \u5929\u624D\u6559\u80B2|\u5929\u624D\u6A6B\u6EA2 \u5929\u624D\u6A6B\u6EA2|\u5929\u624D\u8AD6 \u5929\u624D\u8AD6|\u5929\u7E31\u4E4B\u624D \u5929\u7E31\u4E4B\u624D|\u592A\u4E59\u795E\u91DD \u592A\u4E59\u795E\u91DD|\u5947\u624D \u5947\u624D|\u5947\u624D\u7570\u80FD \u5947\u624D\u7570\u80FD|\u5973\u4EBA\u5FC3\u6D77\u5E95\u91DD \u5973\u4EBA\u5FC3\u6D77\u5E95\u91DD|\u5973\u5B50\u53C3\u653F\u4E3B\u7FA9 \u5973\u5B50\u53C3\u653F\u4E3B\u7FA9|\u5973\u5B50\u53C3\u653F\u6B0A \u5973\u5B50\u53C3\u653F\u6B0A|\u5973\u79C0\u624D \u5973\u79C0\u624D|\u5973\u8C8C\u90CE\u624D \u5973\u8C8C\u90CE\u624D|\u5974\u624D \u5974\u624D|\u5999\u624D \u5999\u624D|\u5B78\u512A\u624D\u8D0D \u5B78\u512A\u624D\u8D0D|\u5B78\u6DFA\u624D\u758F \u5B78\u6DFA\u624D\u758F|\u5B78\u758F\u624D\u6DFA \u5B78\u758F\u624D\u6DFA|\u5B8F\u5167\u6838 \u5B8F\u5167\u6838|\u5B9A\u5357\u91DD \u5B9A\u5357\u91DD|\u5B9A\u98A8\u91DD \u5B9A\u98A8\u91DD|\u5BE6\u624D \u5BE6\u624D|\u5C07\u624D \u5C07\u624D|\u5C07\u9047\u826F\u624D \u5C07\u9047\u826F\u624D|\u5C08\u624D \u5C08\u624D|\u5C08\u696D\u4EBA\u624D \u5C08\u696D\u4EBA\u624D|\u5C08\u9580\u4EBA\u624D \u5C08\u9580\u4EBA\u624D|\u5C0D\u91DD \u5C0D\u91DD|\u5C0F\u624D\u5927\u7528 \u5C0F\u624D\u5927\u7528|\u5C0F\u624D\u5B50 \u5C0F\u624D\u5B50|\u5C0F\u79C0\u624D \u5C0F\u79C0\u624D|\u5C0F\u79C0\u624D\u5B78\u5802 \u5C0F\u79C0\u624D\u5B78\u5802|\u5C0F\u91DD \u5C0F\u91DD|\u5C0F\u91DD\u7F8E\u5BB9 \u5C0F\u91DD\u7F8E\u5BB9|\u5C11\u5E74\u624D\u4FCA \u5C11\u5E74\u624D\u4FCA|\u5C3A\u4E8C\u79C0\u624D \u5C3A\u4E8C\u79C0\u624D|\u5C48\u624D \u5C48\u624D|\u5C55\u624D \u5C55\u624D|\u5C91\u53C3 \u5C91\u53C3|\u5DE8\u8457 \u5DE8\u8457|\u5E36\u5718\u53C3\u52A0 \u5E36\u5718\u53C3\u52A0|\u5E38\u7528\u53C3\u8003\u66F8 \u5E38\u7528\u53C3\u8003\u66F8|\u5E73\u91DD\u7E2B \u5E73\u91DD\u7E2B|\u5E79\u624D \u5E79\u624D|\u5E7E\u91DD \u5E7E\u91DD|\u5EB8\u624D \u5EB8\u624D|\u5EE9\u81B3\u79C0\u624D \u5EE9\u81B3\u79C0\u624D|\u5F15\u7DDA\u7A7F\u91DD \u5F15\u7DDA\u7A7F\u91DD|\u5F35\u53E3 \u5F35\u53E3|\u5F35\u98DB\u7A7F\u91DD \u5F35\u98DB\u7A7F\u91DD|\u5F37\u5FC3\u91DD \u5F37\u5FC3\u91DD|\u5F3C\u91DD \u5F3C\u91DD|\u5F48\u91DD \u5F48\u91DD|\u5F57\u6838 \u5F57\u6838|\u5F62\u540D\u53C3\u540C \u5F62\u540D\u53C3\u540C|\u5F85\u8457 \u5F85\u7740|\u5F97\u5931\u53C3\u534A \u5F97\u5931\u53C3\u534A|\u5FAE\u6838 \u5FAE\u6838|\u5FB5\u624D \u5FB5\u624D|\u5FB7\u624D \u5FB7\u624D|\u5FB7\u624D\u517C\u5099 \u5FB7\u624D\u517C\u5099|\u5FB7\u8584\u624D\u758F \u5FB7\u8584\u624D\u758F|\u5FD7\u5927\u624D\u758F \u5FD7\u5927\u624D\u758F|\u5FD7\u5927\u624D\u77ED \u5FD7\u5927\u624D\u77ED|\u5FD7\u5EE3\u624D\u758F \u5FD7\u5EE3\u624D\u758F|\u6043\u624D\u50B2\u7269 \u6043\u624D\u50B2\u7269|\u6043\u624D\u77DC\u5DF1 \u6043\u624D\u77DC\u5DF1|\u6043\u624D\u81EA\u5C08 \u6043\u624D\u81EA\u5C08|\u60E1\u540D\u662D\u8457 \u60E1\u540D\u662D\u8457|\u610F\u5EE3\u624D\u758F \u610F\u5EE3\u624D\u758F|\u611B\u624D \u611B\u624D|\u611B\u624D\u597D\u58EB \u611B\u624D\u597D\u58EB|\u611B\u624D\u5982\u547D \u611B\u624D\u5982\u547D|\u611B\u624D\u82E5\u6E34 \u611B\u624D\u82E5\u6E34|\u6182\u559C\u53C3\u534A \u6182\u559C\u53C3\u534A|\u6190\u624D \u6190\u624D|\u61F7\u624D\u4E0D\u9047 \u61F7\u624D\u4E0D\u9047|\u61F7\u624D\u62B1\u5FB7 \u61F7\u624D\u62B1\u5FB7|\u61F8\u91DD \u61F8\u91DD|\u61F8\u91DD\u5782\u9732 \u61F8\u91DD\u5782\u9732|\u6210\u5146\u624D \u6210\u5146\u624D|\u6210\u6838 \u6210\u6838|\u6230\u8853\u6838\u6B66\u5668 \u6230\u8853\u6838\u6B66\u5668|\u624B\u8155\u5F0F\u6307\u5317\u91DD \u624B\u8155\u5F0F\u6307\u5317\u91DD|\u624D\u4EBA \u624D\u4EBA|\u624D\u4FCA \u624D\u4FCA|\u624D\u5132\u516B\u6597 \u624D\u5132\u516B\u6597|\u624D\u5177 \u624D\u5177|\u624D\u517C\u6587\u6B66 \u624D\u517C\u6587\u6B66|\u624D\u5206 \u624D\u5206|\u624D\u529B \u624D\u529B|\u624D\u52C7\u517C\u512A \u624D\u52C7\u517C\u512A|\u624D\u540D \u624D\u540D|\u624D\u5668 \u624D\u5668|\u624D\u58EB \u624D\u58EB|\u624D\u5927\u96E3\u7528 \u624D\u5927\u96E3\u7528|\u624D\u5973 \u624D\u5973|\u624D\u5982\u53F2\u9077 \u624D\u5982\u53F2\u9077|\u624D\u5A9B \u624D\u5A9B|\u624D\u5B50 \u624D\u5B50|\u624D\u5B50\u4F73\u4EBA \u624D\u5B50\u4F73\u4EBA|\u624D\u5B50\u66F8 \u624D\u5B50\u66F8|\u624D\u5B78 \u624D\u5B78|\u624D\u5B78\u517C\u512A \u624D\u5B78\u517C\u512A|\u624D\u5B88 \u624D\u5B88|\u624D\u5B9A \u624D\u5B9A|\u624D\u5E79 \u624D\u5E79|\u624D\u5EE3\u59A8\u8EAB \u624D\u5EE3\u59A8\u8EAB|\u624D\u5FAE\u667A\u6DFA \u624D\u5FAE\u667A\u6DFA|\u624D\u5FB7 \u624D\u5FB7|\u624D\u5FB7\u517C\u5099 \u624D\u5FB7\u517C\u5099|\u624D\u601D \u624D\u601D|\u624D\u601D\u654F\u6377 \u624D\u601D\u654F\u6377|\u624D\u609F \u624D\u609F|\u624D\u60C5 \u624D\u60C5|\u624D\u667A \u624D\u667A|\u624D\u671B \u624D\u671B|\u624D\u6C23 \u624D\u6C23|\u624D\u6C23\u7121\u96D9 \u624D\u6C23\u7121\u96D9|\u624D\u6C23\u7E31\u6A6B \u624D\u6C23\u7E31\u6A6B|\u624D\u6C23\u904E\u4EBA \u624D\u6C23\u904E\u4EBA|\u624D\u7232\u4E16\u51FA \u624D\u7232\u4E16\u51FA|\u624D\u7528 \u624D\u7528|\u624D\u7565 \u624D\u7565|\u624D\u7565\u904E\u4EBA \u624D\u7565\u904E\u4EBA|\u624D\u7576\u66F9\u6597 \u624D\u7576\u66F9\u6597|\u624D\u758F\u5B78\u6DFA \u624D\u758F\u5B78\u6DFA|\u624D\u758F\u5FB7\u8584 \u624D\u758F\u5FB7\u8584|\u624D\u758F\u5FD7\u5927 \u624D\u758F\u5FD7\u5927|\u624D\u758F\u610F\u5EE3 \u624D\u758F\u610F\u5EE3|\u624D\u758F\u8A08\u62D9 \u624D\u758F\u8A08\u62D9|\u624D\u77ED\u6C23\u7C97 \u624D\u77ED\u6C23\u7C97|\u624D\u79C0\u4EBA\u5FAE \u624D\u79C0\u4EBA\u5FAE|\u624D\u80FD \u624D\u80FD|\u624D\u80FD\u5E79\u6FDF \u624D\u80FD\u5E79\u6FDF|\u624D\u8272 \u624D\u8272|\u624D\u83EF \u624D\u83EF|\u624D\u83EF\u51FA\u8846 \u624D\u83EF\u51FA\u8846|\u624D\u83EF\u6A6B\u6EA2 \u624D\u83EF\u6A6B\u6EA2|\u624D\u83EF\u6D0B\u6EA2 \u624D\u83EF\u6D0B\u6EA2|\u624D\u83EF\u84CB\u4E16 \u624D\u83EF\u84CB\u4E16|\u624D\u853D\u8B58\u6DFA \u624D\u853D\u8B58\u6DFA|\u624D\u85DD \u624D\u85DD|\u624D\u85DD\u5353\u7D55 \u624D\u85DD\u5353\u7D55|\u624D\u85DD\u6280\u80FD \u624D\u85DD\u6280\u80FD|\u624D\u85DD\u73ED \u624D\u85DD\u73ED|\u624D\u85DD\u79C0 \u624D\u85DD\u79C0|\u624D\u85FB \u624D\u85FB|\u624D\u8A9E \u624D\u8A9E|\u624D\u8B58 \u624D\u8B58|\u624D\u8B58\u904E\u4EBA \u624D\u8B58\u904E\u4EBA|\u624D\u8C8C \u624D\u8C8C|\u624D\u8C8C\u51FA\u8846 \u624D\u8C8C\u51FA\u8846|\u624D\u8C8C\u96D9\u5168 \u624D\u8C8C\u96D9\u5168|\u624D\u8CAB\u4E8C\u9149 \u624D\u8CAB\u4E8C\u9149|\u624D\u8CC7 \u624D\u8CC7|\u624D\u8F15\u5FB7\u8584 \u624D\u8F15\u5FB7\u8584|\u624D\u904E\u5B50\u5EFA \u624D\u904E\u5B50\u5EFA|\u624D\u904E\u5C48\u5B8B \u624D\u904E\u5C48\u5B8B|\u624D\u975E\u7389\u6F64 \u624D\u975E\u7389\u6F64|\u624D\u9AD8\u516B\u6597 \u624D\u9AD8\u516B\u6597|\u624D\u9AD8\u610F\u5EE3 \u624D\u9AD8\u610F\u5EE3|\u624D\u9AD8\u6C23\u50B2 \u624D\u9AD8\u6C23\u50B2|\u624D\u9AD8\u884C\u539A \u624D\u9AD8\u884C\u539A|\u624D\u9AD8\u884C\u6F54 \u624D\u9AD8\u884C\u6F54|\u624E\u91DD \u624E\u91DD|\u6253\u53C3 \u6253\u53C3|\u6253\u5B8C\u91DD \u6253\u5B8C\u91DD|\u6253\u91DD \u6253\u91DD|\u62AB\u91DD\u5F62\u8449 \u62AB\u91DD\u5F62\u8449|\u62B5\u91DD \u62B5\u91DD|\u62C8\u91DD\u6307 \u62C8\u91DD\u6307|\u62D4\u5730\u53C3\u5929 \u62D4\u5730\u53C3\u5929|\u6307\u5317\u91DD \u6307\u5317\u91DD|\u6307\u5357\u91DD \u6307\u5357\u91DD|\u6307\u91DD \u6307\u91DD|\u6307\u91DD\u5F0F \u6307\u91DD\u5F0F|\u636B\u53C3\u6B77\u4E95 \u636B\u53C3\u6B77\u4E95|\u6377\u624D \u6377\u624D|\u6383\u7709\u624D\u5B50 \u6383\u7709\u624D\u5B50|\u63A2\u91DD \u63A2\u91DD|\u63D2\u91DD \u63D2\u91DD|\u63DA\u5DF1\u9732\u624D \u63DA\u5DF1\u9732\u624D|\u6416\u91DD \u6416\u91DD|\u6417\u91DD \u6417\u91DD|\u649E\u91DD \u649E\u91DD|\u64A5\u4E82\u4E4B\u624D \u64A5\u4E82\u4E4B\u624D|\u64EC\u6838 \u64EC\u6838|\u64FA\u91DD \u64FA\u91DD|\u6536\u91DD \u6536\u91DD|\u653E\u53C3 \u653E\u53C3|\u6559\u80B2\u65B9\u91DD \u6559\u80B2\u65B9\u91DD|\u6579\u4E00\u91DD \u6579\u4E00\u91DD|\u6587\u624D \u6587\u624D|\u6587\u6B66\u5168\u624D \u6587\u6B66\u5168\u624D|\u6587\u9078\u721B\u79C0\u624D\u534A \u6587\u9078\u721B\u79C0\u624D\u534A|\u6597\u7B72\u4E4B\u624D \u6597\u7B72\u4E4B\u624D|\u6597\u8F49\u53C3\u6A6B \u6597\u8F49\u53C3\u6A6B|\u65B9\u91DD \u65B9\u91DD|\u65E5\u6708\u53C3\u8FB0 \u65E5\u6708\u53C3\u8FB0|\u65E9\u53C3 \u65E9\u53C3|\u662D\u8457 \u662D\u8457|\u6642\u91DD \u6642\u91DD|\u665A\u53C3 \u665A\u53C3|\u6668\u53C3\u66AE\u7701 \u6668\u53C3\u66AE\u7701|\u6668\u53C3\u66AE\u79AE \u6668\u53C3\u66AE\u79AE|\u6676\u6838 \u6676\u6838|\u6688\u91DD \u6688\u91DD|\u66AE\u79AE\u6668\u53C3 \u66AE\u79AE\u6668\u53C3|\u66E0\u4E16\u4E4B\u624D \u66E0\u4E16\u4E4B\u624D|\u66E0\u4E16\u5947\u624D \u66E0\u4E16\u5947\u624D|\u66E0\u4E16\u9038\u624D \u66E0\u4E16\u9038\u624D|\u66F2\u5225\u91DD \u66F2\u5225\u91DD|\u66F9\u53C3 \u66F9\u53C3|\u66FE\u53C3 \u66FE\u53C3|\u66FE\u53C3\u6BBA\u4EBA \u66FE\u53C3\u6BBA\u4EBA|\u6708\u6838 \u6708\u6838|\u6708\u843D\u53C3\u6A6B \u6708\u843D\u53C3\u6A6B|\u6709\u624D \u6709\u624D|\u6709\u624D\u5E79 \u6709\u624D\u5E79|\u6709\u624D\u7121\u547D \u6709\u624D\u7121\u547D|\u6709\u6838 \u6709\u6838|\u671D\u53C3\u66AE\u79AE \u671D\u53C3\u66AE\u79AE|\u671D\u6838 \u671D\u6838|\u672A\u6613\u624D \u672A\u6613\u624D|\u673D\u6728\u4E4B\u624D \u673D\u6728\u4E4B\u624D|\u674F\u6838 \u674F\u6838|\u6771\u6D77\u6488\u91DD \u6771\u6D77\u6488\u91DD|\u677E\u91DD \u677E\u91DD|\u6797\u6728\u53C3\u5929 \u6797\u6728\u53C3\u5929|\u679C\u6838 \u679C\u6838|\u679D\u91DD \u679D\u91DD|\u6838\u4E0B \u6838\u4E0B|\u6838\u4E8C\u5EE0 \u6838\u4E8C\u5EE0|\u6838\u4EBA \u6838\u4EBA|\u6838\u4EC1 \u6838\u4EC1|\u6838\u4EE5 \u6838\u4EE5|\u6838\u50F5\u6301 \u6838\u50F5\u6301|\u6838\u5152 \u6838\u5152|\u6838\u51AC\u5929 \u6838\u51AC\u5929|\u6838\u51FA\u53E3\u63A7\u5236 \u6838\u51FA\u53E3\u63A7\u5236|\u6838\u529B \u6838\u529B|\u6838\u5316 \u6838\u5316|\u6838\u5340 \u6838\u5340|\u6838\u53EF \u6838\u53EF|\u6838\u5408\u6210 \u6838\u5408\u6210|\u6838\u548C \u6838\u548C|\u6838\u56DB \u6838\u56DB|\u6838\u578B \u6838\u578B|\u6838\u5B50 \u6838\u5B50|\u6838\u5B50\u5EE0 \u6838\u5B50\u5EE0|\u6838\u5B54 \u6838\u5B54|\u6838\u5CF6 \u6838\u5CF6|\u6838\u5DE5 \u6838\u5DE5|\u6838\u5F48 \u6838\u5F48|\u6838\u5FC3 \u6838\u5FC3|\u6838\u6230 \u6838\u6230|\u6838\u6230\u9B25\u90E8 \u6838\u6230\u9B25\u90E8|\u6838\u6280\u8853 \u6838\u6280\u8853|\u6838\u6578 \u6838\u6578|\u6838\u662F \u6838\u662F|\u6838\u6709 \u6838\u6709|\u6838\u679C \u6838\u679C|\u6838\u6843 \u6838\u6843|\u6838\u6B66 \u6838\u6B66|\u6838\u706B\u7BAD\u767C\u52D5\u6A5F \u6838\u706B\u7BAD\u767C\u52D5\u6A5F|\u6838\u70AB \u6838\u70AB|\u6838\u71C3\u6599\u5F8C\u8655\u7406 \u6838\u71C3\u6599\u5F8C\u8655\u7406|\u6838\u7206 \u6838\u7206|\u6838\u7206\u70B8\u7159\u96F2 \u6838\u7206\u70B8\u7159\u96F2|\u6838\u72C0 \u6838\u72C0|\u6838\u7403 \u6838\u7403|\u6838\u7518 \u6838\u7518|\u6838\u7576\u91CF \u6838\u7576\u91CF|\u6838\u767C \u6838\u767C|\u6838\u767C\u96FB \u6838\u767C\u96FB|\u6838\u767C\u96FB\u5EE0 \u6838\u767C\u96FB\u5EE0|\u6838\u7684 \u6838\u7684|\u6838\u78C1 \u6838\u78C1|\u6838\u7A2E \u6838\u7A2E|\u6838\u7A81 \u6838\u7A81|\u6838\u7C92 \u6838\u7C92|\u6838\u7CD6 \u6838\u7CD6|\u6838\u7CD6\u6838\u9178 \u6838\u7CD6\u6838\u9178|\u6838\u7D20 \u6838\u7D20|\u6838\u7DDA \u6838\u7DDA|\u6838\u80FD \u6838\u80FD|\u6838\u80FD\u6280\u8853 \u6838\u80FD\u6280\u8853|\u6838\u80FD\u767C\u96FB \u6838\u80FD\u767C\u96FB|\u6838\u80FD\u767C\u96FB\u5EE0 \u6838\u80FD\u767C\u96FB\u5EE0|\u6838\u80FD\u96FB\u5EE0 \u6838\u80FD\u96FB\u5EE0|\u6838\u819C \u6838\u819C|\u6838\u82F7 \u6838\u82F7|\u6838\u83CC \u6838\u83CC|\u6838\u878D\u5408 \u6838\u878D\u5408|\u6838\u878D\u5408\u767C\u96FB \u6838\u878D\u5408\u767C\u96FB|\u6838\u89E3 \u6838\u89E3|\u6838\u8A08\u5283 \u6838\u8A08\u5283|\u6838\u8A66 \u6838\u8A66|\u6838\u8AC7 \u6838\u8AC7|\u6838\u8CEA \u6838\u8CEA|\u6838\u8F09 \u6838\u8F09|\u6838\u8FA6 \u6838\u8FA6|\u6838\u914D \u6838\u914D|\u6838\u916A \u6838\u916A|\u6838\u9176 \u6838\u9176|\u6838\u9178 \u6838\u9178|\u6838\u9632\u79A6 \u6838\u9632\u79A6|\u6838\u96FB \u6838\u96FB|\u6838\u96FB\u5EE0 \u6838\u96FB\u5EE0|\u6838\u96FB\u78C1\u8108\u885D \u6838\u96FB\u78C1\u8108\u885D|\u6838\u9AD4 \u6838\u9AD4|\u6838\u9EDE \u6838\u9EDE|\u6843\u6838 \u6843\u6838|\u6843\u6838\u96D5 \u6843\u6838\u96D5|\u6851\u91DD \u6851\u91DD|\u6885\u6838 \u6885\u6838|\u68C4\u6838 \u68C4\u6838|\u68CB\u9022\u5C0D\u624B\u5C07\u9047\u826F\u624D \u68CB\u9022\u5C0D\u624B\u5C07\u9047\u826F\u624D|\u68D2\u91DD \u68D2\u91DD|\u68D2\u91DD\u886B \u68D2\u91DD\u886B|\u68D7\u6838 \u68D7\u6838|\u68D8\u91DD \u68D8\u91DD|\u68D8\u91DD\u79D1 \u68D8\u91DD\u79D1|\u68D8\u91DD\u9580 \u68D8\u91DD\u9580|\u6975\u6838 \u6975\u6838|\u69C3\u624D \u69C3\u624D|\u69C3\u69C3\u5927\u624D \u69C3\u69C3\u5927\u624D|\u6A58\u6838 \u6A58\u6838|\u6AA2\u6838 \u6AA2\u6838|\u6AA2\u6838\u8868 \u6AA2\u6838\u8868|\u6B63\u5247\u53C3\u6578 \u6B63\u5247\u53C3\u6578|\u6B65\u7DDA\u884C\u91DD \u6B65\u7DDA\u884C\u91DD|\u6B6A\u624D \u6B6A\u624D|\u6B77\u7DF4\u4E4B\u624D \u6B77\u7DF4\u4E4B\u624D|\u6BBA\u624D \u6BBA\u624D|\u6BD2\u91DD \u6BD2\u91DD|\u6BD4\u624D \u6BD4\u624D|\u6BDB\u7DDA\u91DD \u6BDB\u7DDA\u91DD|\u6BEB\u91DD \u6BEB\u91DD|\u6C18\u6838 \u6C18\u6838|\u6C34\u5E95\u6488\u91DD \u6C34\u5E95\u6488\u91DD|\u6C42\u624D \u6C42\u624D|\u6C42\u624D\u82E5\u6E34 \u6C42\u624D\u82E5\u6E34|\u6C5F\u5357\u56DB\u5927\u624D\u5B50 \u6C5F\u5357\u56DB\u5927\u624D\u5B50|\u6C5F\u53C3 \u6C5F\u53C3|\u6C5F\u6DF9\u624D\u76E1 \u6C5F\u6DF9\u624D\u76E1|\u6C5F\u90CE\u624D\u76E1 \u6C5F\u90CE\u624D\u76E1|\u6CBF\u624D\u6388\u8077 \u6CBF\u624D\u6388\u8077|\u6CE8\u5C04\u91DD \u6CE8\u5C04\u91DD|\u6CE8\u5C04\u91DD\u982D \u6CE8\u5C04\u91DD\u982D|\u6D17\u9762\u7682 \u6D17\u9762\u7682|\u6D17\u9AEE\u7682 \u6D17\u9AEE\u7682|\u6D1B\u967D\u624D\u5B50 \u6D1B\u967D\u624D\u5B50|\u6D3E\u5718\u53C3\u52A0 \u6D3E\u5718\u53C3\u52A0|\u6D77\u53C3\u5A01 \u6D77\u53C3\u5A01|\u6D77\u53C3\u5D34 \u6D77\u53C3\u5D34|\u6D77\u5E95\u6488\u91DD \u6D77\u5E95\u6488\u91DD|\u6EFF\u8179\u624D\u5B78 \u6EFF\u8179\u624D\u5B78|\u6F0F\u91DD \u6F0F\u91DD|\u6F51\u624D \u6F51\u624D|\u6FDF\u4E16\u4E4B\u624D \u6FDF\u4E16\u4E4B\u624D|\u7121\u6838 \u7121\u6838|\u7121\u91DD\u4E0D\u5F15\u7DDA \u7121\u91DD\u4E0D\u5F15\u7DDA|\u7121\u91DD\u6CE8\u5C04\u5668 \u7121\u91DD\u6CE8\u5C04\u5668|\u7164\u6838 \u7164\u6838|\u7194\u6838 \u7194\u6838|\u71B1\u6838 \u71B1\u6838|\u71D4\u91DD \u71D4\u91DD|\u7247\u5584\u5C0F\u624D \u7247\u5584\u5C0F\u624D|\u7269\u8272\u4EBA\u624D \u7269\u8272\u4EBA\u624D|\u7279\u6B8A\u624D\u80FD \u7279\u6B8A\u624D\u80FD|\u72C0\u614B\u53C3\u6578 \u72C0\u614B\u53C3\u6578|\u72D7\u624D \u72D7\u624D|\u7387\u5718\u53C3\u52A0 \u7387\u5718\u53C3\u52A0|\u7389\u53C3\u5DEE \u7389\u53C3\u5DEE|\u7389\u5C3A\u91CF\u624D \u7389\u5C3A\u91CF\u624D|\u738B\u4F50\u4E4B\u624D \u738B\u4F50\u4E4B\u624D|\u7463\u624D \u7463\u624D|\u7504\u624D\u54C1\u80FD \u7504\u624D\u54C1\u80FD|\u7504\u9078\u4EBA\u624D \u7504\u9078\u4EBA\u624D|\u7537\u624D\u5973\u8C8C \u7537\u624D\u5973\u8C8C|\u754E\u755D\u4E0B\u624D \u754E\u755D\u4E0B\u624D|\u7559\u91DD \u7559\u91DD|\u7565\u7121\u53C3\u5546 \u7565\u7121\u53C3\u5546|\u7570\u624D \u7570\u624D|\u7576\u4E16\u624D\u5EA6 \u7576\u4E16\u624D\u5EA6|\u7591\u4FE1\u53C3\u534A \u7591\u4FE1\u53C3\u534A|\u7591\u6838 \u7591\u6838|\u75D4\u6838 \u75D4\u6838|\u75DB\u5931\u82F1\u624D \u75DB\u5931\u82F1\u624D|\u767B\u5EB8\u4EBA\u624D \u767B\u5EB8\u4EBA\u624D|\u767C\u5C55\u6838\u6B66\u5668 \u767C\u5C55\u6838\u6B66\u5668|\u767D\u9DB4\u79C0\u624D \u767D\u9DB4\u79C0\u624D|\u767E\u842C\u5678\u7D1A\u6838\u6B66\u5668 \u767E\u842C\u5678\u7D1A\u6838\u6B66\u5668|\u767E\u91CC\u4E4B\u624D \u767E\u91CC\u4E4B\u624D|\u7682\u5316 \u7682\u5316|\u7682\u83A2 \u7682\u83A2|\u7682\u83A2\u6A39 \u7682\u83A2\u6A39|\u7682\u89D2 \u7682\u89D2|\u7684\u6838 \u7684\u6838|\u76F4\u63A5\u53C3\u8207 \u76F4\u63A5\u53C3\u8207|\u771F\u624D\u5BE6\u5B78 \u771F\u624D\u5BE6\u5B78|\u771F\u6838 \u771F\u6838|\u77DC\u624D\u4F7F\u6C23 \u77DC\u624D\u4F7F\u6C23|\u77DC\u80FD\u8CA0\u624D \u77DC\u80FD\u8CA0\u624D|\u77ED\u91DD \u77ED\u91DD|\u77F3\u91DD \u77F3\u91DD|\u786C\u6838 \u786C\u6838|\u786C\u80A5\u7682 \u786C\u80A5\u7682|\u788C\u788C\u5EB8\u624D \u788C\u788C\u5EB8\u624D|\u78C1\u6838 \u78C1\u6838|\u78C1\u91DD \u78C1\u91DD|\u78E8\u6775\u6210\u91DD \u78E8\u6775\u6210\u91DD|\u78E8\u91DD\u6EAA \u78E8\u91DD\u6EAA|\u78E8\u9435\u6210\u91DD \u78E8\u9435\u6210\u91DD|\u793E\u4EA4\u624D\u80FD \u793E\u4EA4\u624D\u80FD|\u7981\u6838 \u7981\u6838|\u79C0\u624D \u79C0\u624D|\u79C0\u624D\u4E0D\u51FA\u9580\u80FD\u77E5\u5929\u4E0B\u4E8B \u79C0\u624D\u4E0D\u51FA\u9580\u80FD\u77E5\u5929\u4E0B\u4E8B|\u79C0\u624D\u4EBA\u60C5 \u79C0\u624D\u4EBA\u60C5|\u79C0\u624D\u4F5C\u91AB\u5982\u83DC\u4F5C\u8640 \u79C0\u624D\u4F5C\u91AB\u5982\u83DC\u4F5C\u8640|\u79C0\u624D\u9020\u53CD \u79C0\u624D\u9020\u53CD|\u79D2\u91DD \u79D2\u91DD|\u79E7\u91DD \u79E7\u91DD|\u7A46\u7A1C \u7A46\u7A1C|\u7A4D\u6975\u53C3\u52A0 \u7A4D\u6975\u53C3\u52A0|\u7A4D\u6975\u53C3\u8207 \u7A4D\u6975\u53C3\u8207|\u7A7F\u91DD \u7A7F\u91DD|\u7A7F\u91DD\u5F15\u7DDA \u7A7F\u91DD\u5F15\u7DDA|\u7A7F\u91DD\u8D70\u7DDA \u7A7F\u91DD\u8D70\u7DDA|\u7B46\u53C3\u9020\u5316 \u7B46\u53C3\u9020\u5316|\u7BA1\u7406\u4EBA\u624D \u7BA1\u7406\u4EBA\u624D|\u7CBE\u6838 \u7CBE\u6838|\u7D04\u6838 \u7D04\u6838|\u7D04\u7FF0\u53C3\u66F8 \u7D04\u7FF0\u53C3\u66F8|\u7D0B\u5149\u91DD \u7D0B\u5149\u91DD|\u7D30\u91DD\u5BC6\u7E37 \u7D30\u91DD\u5BC6\u7E37|\u7D50\u6838 \u7D50\u6838|\u7D50\u6838\u687F\u83CC \u7D50\u6838\u687F\u83CC|\u7D55\u5C0D\u53C3\u7167 \u7D55\u5C0D\u53C3\u7167|\u7D55\u624D \u7D55\u624D|\u7D5E\u5305\u91DD \u7D5E\u5305\u91DD|\u7D66\u500B\u68D2\u9318\u7576\u91DD\u8A8D \u7D66\u500B\u68D2\u9318\u7576\u91DD\u8A8D|\u7D8F\u7A1C \u7D8F\u7A1C|\u7D93\u4E16\u4E4B\u624D \u7D93\u4E16\u4E4B\u624D|\u7D93\u570B\u4E4B\u624D \u7D93\u570B\u4E4B\u624D|\u7D93\u6FDF\u4E4B\u624D \u7D93\u6FDF\u4E4B\u624D|\u7DB2\u7F85\u4EBA\u624D \u7DB2\u7F85\u4EBA\u624D|\u7DBF\u88CF\u85CF\u91DD \u7DBF\u88CF\u85CF\u91DD|\u7DBF\u88CF\u91DD \u7DBF\u88CF\u91DD|\u7E2B\u8863\u91DD \u7E2B\u8863\u91DD|\u7E2B\u91DD \u7E2B\u91DD|\u7E2B\u91DD\u88DC\u7DDA \u7E2B\u91DD\u88DC\u7DDA|\u7E2B\u91DD\u8DE1 \u7E2B\u91DD\u8DE1|\u7E3D\u53C3\u8B00\u90E8 \u7E3D\u53C3\u8B00\u90E8|\u7E3D\u53C3\u8B00\u9577 \u7E3D\u53C3\u8B00\u9577|\u7E3D\u65B9\u91DD \u7E3D\u65B9\u91DD|\u7E43\u91DD \u7E43\u91DD|\u7E61\u82B1\u91DD \u7E61\u82B1\u91DD|\u7E61\u82B1\u91DD\u5152 \u7E61\u82B1\u91DD\u5152|\u7E61\u91DD \u7E61\u91DD|\u7F85\u76E4\u91DD \u7F85\u76E4\u91DD|\u7F8E\u570B\u53C3\u8B70\u9662 \u7F8E\u570B\u53C3\u8B70\u9662|\u7F8E\u624D \u7F8E\u624D|\u7F8E\u767D\u91DD \u7F8E\u767D\u91DD|\u8001\u5974\u624D \u8001\u5974\u624D|\u8010\u591A\u85E5\u7D50\u6838\u75C5 \u8010\u591A\u85E5\u7D50\u6838\u75C5|\u8033\u91DD \u8033\u91DD|\u806F\u5408\u53C3\u8B00 \u806F\u5408\u53C3\u8B00|\u8070\u660E\u624D\u667A \u8070\u660E\u624D\u667A|\u80A5\u7682 \u80A5\u7682|\u80A5\u7682\u5287 \u80A5\u7682\u5287|\u80A5\u7682\u6CE1 \u80A5\u7682\u6CE1|\u80A5\u7682\u7C89 \u80A5\u7682\u7C89|\u80A5\u7682\u7D72 \u80A5\u7682\u7D72|\u80A5\u7682\u83A2 \u80A5\u7682\u83A2|\u80B2\u624D \u80B2\u624D|\u80C3\u53E3 \u80C3\u53E3|\u80E1\u624D\u52C7 \u80E1\u624D\u52C7|\u80F8\u91DD \u80F8\u91DD|\u81EA\u5B78\u6210\u624D \u81EA\u5B78\u6210\u624D|\u81EA\u6838 \u81EA\u6838|\u8239\u4E0D\u6F0F\u91DD\u6F0F\u91DD\u6C92\u5916\u4EBA \u8239\u4E0D\u6F0F\u91DD\u6F0F\u91DD\u6C92\u5916\u4EBA|\u82B1\u5152\u91DD \u82B1\u5152\u91DD|\u82B1\u65D7\u53C3 \u82B1\u65D7\u53C3|\u82F1\u624D \u82F1\u624D|\u82F1\u624D\u4FCA\u5049 \u82F1\u624D\u4FCA\u5049|\u8302\u624D \u8302\u624D|\u8302\u624D\u7570\u7B49 \u8302\u624D\u7570\u7B49|\u8305\u91DD \u8305\u91DD|\u8332\u6838 \u8332\u6838|\u83CC\u6838 \u83CC\u6838|\u83F2\u624D\u5BE1\u5B78 \u83F2\u624D\u5BE1\u5B78|\u8449\u91DD \u8449\u91DD|\u8457\u4F5C \u8457\u4F5C|\u8457\u540D \u8457\u540D|\u8457\u5F0F \u8457\u5F0F|\u8457\u5FD7 \u8457\u5FD7|\u8457\u65BC \u8457\u65BC|\u8457\u66F8 \u8457\u66F8|\u8457\u767D \u8457\u767D|\u8457\u7A31 \u8457\u7A31|\u8457\u7A31\u65BC\u4E16 \u8457\u7A31\u65BC\u4E16|\u8457\u8005 \u8457\u8005|\u8457\u8FF0 \u8457\u8FF0|\u8457\u9304 \u8457\u9304|\u84CB\u4E16\u4E4B\u624D \u84CB\u4E16\u4E4B\u624D|\u85CF\u91DD\u7E2B \u85CF\u91DD\u7E2B|\u85E5\u7682 \u85E5\u7682|\u85E5\u91DD \u85E5\u91DD|\u860B\u679C\u6838 \u860B\u679C\u6838|\u86C7\u53E3\u8702\u91DD \u86C7\u53E3\u8702\u91DD|\u87AB\u91DD \u87AB\u91DD|\u883B\u91DD\u778E\u7078 \u883B\u91DD\u778E\u7078|\u884C\u77ED\u624D\u55AC \u884C\u77ED\u624D\u55AC|\u884C\u77ED\u624D\u9AD8 \u884C\u77ED\u624D\u9AD8|\u88DC\u8840\u91DD \u88DC\u8840\u91DD|\u88DC\u91DD \u88DC\u91DD|\u88FD\u9EB5 \u88FD\u9EAA|\u897F\u6D0B\u53C3 \u897F\u6D0B\u53C3|\u898B\u7E2B\u63D2\u91DD \u898B\u7E2B\u63D2\u91DD|\u8A0E\u91DD\u7DDA \u8A0E\u91DD\u7DDA|\u8A60\u96EA\u4E4B\u624D \u8A60\u96EA\u4E4B\u624D|\u8A69\u624D \u8A69\u624D|\u8A87\u624D\u8CE3\u667A \u8A87\u624D\u8CE3\u667A|\u8AAA\u53C3\u8ACB \u8AAA\u53C3\u8ACB|\u8ACB\u53C3\u95B1 \u8ACB\u53C3\u95B1|\u8B0A\u6572\u624D \u8B0A\u6572\u624D|\u8B1D\u7D55\u53C3\u89C0 \u8B1D\u7D55\u53C3\u89C0|\u8B58\u591A\u624D\u5EE3 \u8B58\u591A\u624D\u5EE3|\u8B58\u624D \u8B58\u624D|\u8B58\u624D\u5C0A\u8CE2 \u8B58\u624D\u5C0A\u8CE2|\u8B6D\u8B7D\u53C3\u534A \u8B6D\u8B7D\u53C3\u534A|\u8C61\u7259\u91DD\u5C16 \u8C61\u7259\u91DD\u5C16|\u8C6C\u516B\u6212\u55AB\u4EBA\u53C3\u679C \u8C6C\u516B\u6212\u55AB\u4EBA\u53C3\u679C|\u8CA0\u624D \u8CA0\u624D|\u8CA0\u624D\u4EFB\u6C23 \u8CA0\u624D\u4EFB\u6C23|\u8CA0\u624D\u4F7F\u6C23 \u8CA0\u624D\u4F7F\u6C23|\u8CC0\u723E\u8499\u91DD \u8CC0\u723E\u8499\u91DD|\u8CE2\u624D \u8CE2\u624D|\u8CE4\u624D \u8CE4\u624D|\u8D85\u4E16\u4E4B\u624D \u8D85\u4E16\u4E4B\u624D|\u8DAB\u624D \u8DAB\u624D|\u8DF3\u91DD \u8DF3\u91DD|\u8E47\u5403 \u8E47\u5403|\u8EAB\u624D \u8EAB\u624D|\u8EDF\u80A5\u7682 \u8EDF\u80A5\u7682|\u8F07\u624D \u8F07\u624D|\u8F15\u6838 \u8F15\u6838|\u8FAF\u624D \u8FAF\u624D|\u8FAF\u624D\u5929 \u8FAF\u624D\u5929|\u8FAF\u624D\u7121\u7919 \u8FAF\u624D\u7121\u7919|\u8FF4\u7D0B\u91DD \u8FF4\u7D0B\u91DD|\u9000\u91DD \u9000\u91DD|\u9006\u6642\u91DD \u9006\u6642\u91DD|\u901A\u4EBA\u9054\u624D \u901A\u4EBA\u9054\u624D|\u901A\u624D \u901A\u624D|\u901A\u624D\u6559\u80B2 \u901A\u624D\u6559\u80B2|\u901A\u624D\u7DF4\u8B58 \u901A\u624D\u7DF4\u8B58|\u9020\u5C31\u4EBA\u624D \u9020\u5C31\u4EBA\u624D|\u9038\u624D \u9038\u624D|\u9038\u7FA3\u4E4B\u624D \u9038\u7FA3\u4E4B\u624D|\u904E\u4EBA\u624D\u7565 \u904E\u4EBA\u624D\u7565|\u9055\u7D00\u53C3\u9078 \u9055\u7D00\u53C3\u9078|\u9069\u624D \u9069\u624D|\u9078\u624D \u9078\u624D|\u9078\u6C11\u53C3\u52A0\u7387 \u9078\u6C11\u53C3\u52A0\u7387|\u907A\u624D \u907A\u624D|\u907F\u96F7\u91DD \u907F\u96F7\u91DD|\u908A\u6838 \u908A\u6838|\u90CE\u624D\u5973\u59FF \u90CE\u624D\u5973\u59FF|\u90CE\u624D\u5973\u8C8C \u90CE\u624D\u5973\u8C8C|\u9127\u827E\u5403 \u9127\u827E\u5403|\u91CE\u7121\u907A\u624D \u91CE\u7121\u907A\u624D|\u91CF\u624D\u9304\u7528 \u91CF\u624D\u9304\u7528|\u91D1\u91DD \u91D1\u91DD|\u91D1\u91DD\u5C71 \u91D1\u91DD\u5C71|\u91D1\u91DD\u5EA6\u4EBA \u91D1\u91DD\u5EA6\u4EBA|\u91D1\u91DD\u82B1 \u91D1\u91DD\u82B1|\u91D1\u91DD\u83C7 \u91D1\u91DD\u83C7|\u91D1\u91DD\u83DC \u91D1\u91DD\u83DC|\u91D8\u66F8\u91DD \u91D8\u66F8\u91DD|\u91DD\u5177 \u91DD\u5177|\u91DD\u523A \u91DD\u523A|\u91DD\u523A\u9EBB\u9189 \u91DD\u523A\u9EBB\u9189|\u91DD\u5291 \u91DD\u5291|\u91DD\u5B54 \u91DD\u5B54|\u91DD\u5B54\u651D\u5F71\u6A5F \u91DD\u5B54\u651D\u5F71\u6A5F|\u91DD\u5B54\u7167\u50CF \u91DD\u5B54\u7167\u50CF|\u91DD\u5B54\u7167\u50CF\u6A5F \u91DD\u5B54\u7167\u50CF\u6A5F|\u91DD\u5B54\u73FE\u8C61 \u91DD\u5B54\u73FE\u8C61|\u91DD\u5C0D \u91DD\u5C0D|\u91DD\u5C0D\u6027 \u91DD\u5C0D\u6027|\u91DD\u5C0D\u65BC \u91DD\u5C0D\u65BC|\u91DD\u5C16 \u91DD\u5C16|\u91DD\u5C16\u5152 \u91DD\u5C16\u5152|\u91DD\u5DE5 \u91DD\u5DE5|\u91DD\u5E03 \u91DD\u5E03|\u91DD\u5F62\u8449 \u91DD\u5F62\u8449|\u91DD\u6307 \u91DD\u6307|\u91DD\u6311\u5200\u6316 \u91DD\u6311\u5200\u6316|\u91DD\u68B3\u6A5F \u91DD\u68B3\u6A5F|\u91DD\u6C08 \u91DD\u6C08|\u91DD\u6CD5 \u91DD\u6CD5|\u91DD\u7099 \u91DD\u7099|\u91DD\u72C0 \u91DD\u72C0|\u91DD\u72C0\u7269 \u91DD\u72C0\u7269|\u91DD\u76E4 \u91DD\u76E4|\u91DD\u773C \u91DD\u773C|\u91DD\u773C\u5B50 \u91DD\u773C\u5B50|\u91DD\u795E \u91DD\u795E|\u91DD\u7B46 \u91DD\u7B46|\u91DD\u7B46\u5320 \u91DD\u7B46\u5320|\u91DD\u7B52 \u91DD\u7B52|\u91DD\u7B8D \u91DD\u7B8D|\u91DD\u7B8D\u5152 \u91DD\u7B8D\u5152|\u91DD\u7DDA \u91DD\u7DDA|\u91DD\u7DDA\u5305 \u91DD\u7DDA\u5305|\u91DD\u7DDA\u5A18 \u91DD\u7DDA\u5A18|\u91DD\u7DDA\u6D3B \u91DD\u7DDA\u6D3B|\u91DD\u7DDA\u6D3B\u8A08 \u91DD\u7DDA\u6D3B\u8A08|\u91DD\u7DDA\u76D2 \u91DD\u7DDA\u76D2|\u91DD\u7DDA\u7B94\u7C6C \u91DD\u7DDA\u7B94\u7C6C|\u91DD\u7E54 \u91DD\u7E54|\u91DD\u7E54\u54C1 \u91DD\u7E54\u54C1|\u91DD\u7E54\u5EE0 \u91DD\u7E54\u5EE0|\u91DD\u7E54\u6599 \u91DD\u7E54\u6599|\u91DD\u8173 \u91DD\u8173|\u91DD\u8449 \u91DD\u8449|\u91DD\u8449\u6797 \u91DD\u8449\u6797|\u91DD\u8449\u690D\u7269 \u91DD\u8449\u690D\u7269|\u91DD\u8449\u6A39 \u91DD\u8449\u6A39|\u91DD\u91DD\u898B\u8840 \u91DD\u91DD\u898B\u8840|\u91DD\u91E6 \u91DD\u91E6|\u91DD\u92D2 \u91DD\u92D2|\u91DD\u92D2\u76F8\u5C0D \u91DD\u92D2\u76F8\u5C0D|\u91DD\u92D2\u76F8\u6295 \u91DD\u92D2\u76F8\u6295|\u91DD\u92E9 \u91DD\u92E9|\u91DD\u982D \u91DD\u982D|\u91DD\u990C\u83AB\u6E1B \u91DD\u990C\u83AB\u6E1B|\u91DD\u9AA8 \u91DD\u9AA8|\u91DD\u9B5A \u91DD\u9B5A|\u91DD\u9EF9 \u91DD\u9EF9|\u91DD\u9EF9\u7D21\u7E3E \u91DD\u9EF9\u7D21\u7E3E|\u91DD\u9F34 \u91DD\u9F34|\u91DD\u9F3B \u91DD\u9F3B|\u91DD\u9F3B\u5152 \u91DD\u9F3B\u5152|\u91E6\u91DD \u91E6\u91DD|\u9245\u8457 \u9245\u8457|\u9264\u91DD \u9264\u91DD|\u9280\u6838 \u9280\u6838|\u9280\u91DD \u9280\u91DD|\u92FC\u91DD \u92FC\u91DD|\u9336\u91DD \u9336\u91DD|\u9435\u91DD \u9435\u91DD|\u9451\u6838\u5099\u67E5 \u9451\u6838\u5099\u67E5|\u9577\u624D \u9577\u624D|\u9577\u91DD \u9577\u91DD|\u958B\u53E3 \u958B\u53E3|\u9632\u75AB\u91DD \u9632\u75AB\u91DD|\u9670\u6838 \u9670\u6838|\u96A8\u624D\u5668\u4F7F \u96A8\u624D\u5668\u4F7F|\u96C4\u624D \u96C4\u624D|\u96C4\u624D\u5927\u7565 \u96C4\u624D\u5927\u7565|\u96CC\u6838 \u96CC\u6838|\u96D9\u6838 \u96D9\u6838|\u96D9\u93C8\u6838\u9178 \u96D9\u93C8\u6838\u9178|\u96FB\u5531\u91DD \u96FB\u5531\u91DD|\u96FB\u91DD \u96FB\u91DD|\u96FB\u91DD\u9EBB\u9189 \u96FB\u91DD\u9EBB\u9189|\u9700\u624D\u5B54\u4E9F \u9700\u624D\u5B54\u4E9F|\u9732\u624D \u9732\u624D|\u9732\u624D\u63DA\u5DF1 \u9732\u624D\u63DA\u5DF1|\u9738\u624D \u9738\u624D|\u975E\u624D \u975E\u624D|\u975E\u6838 \u975E\u6838|\u9762\u7682 \u9762\u7682|\u9802\u6838 \u9802\u6838|\u9802\u91DD \u9802\u91DD|\u9802\u91DD\u5152 \u9802\u91DD\u5152|\u9802\u91DD\u6371\u4F4F \u9802\u91DD\u6371\u4F4F|\u9802\u9580\u91DD \u9802\u9580\u91DD|\u9806\u6642\u91DD \u9806\u6642\u91DD|\u9810\u9632\u91DD \u9810\u9632\u91DD|\u9818\u5E36\u91DD \u9818\u5E36\u91DD|\u986F\u8457 \u986F\u8457|\u986F\u8457\u6A19\u5FD7 \u986F\u8457\u6A19\u5FD7|\u98A8\u5411\u91DD \u98A8\u5411\u91DD|\u98A8\u6D41\u624D\u5B50 \u98A8\u6D41\u624D\u5B50|\u98DB\u91DD\u8D70\u7DDA \u98DB\u91DD\u8D70\u7DDA|\u98FD\u5B78\u79C0\u624D \u98FD\u5B78\u79C0\u624D|\u9999\u7682 \u9999\u7682|\u99AE\u9A65\u624D \u99AE\u9A65\u624D|\u9A5A\u624D\u7D55\u8C54 \u9A5A\u624D\u7D55\u8C54|\u9AA8\u91DD \u9AA8\u91DD|\u9AD8\u53C3 \u9AD8\u53C3|\u9AD8\u624D \u9AD8\u624D|\u9AD8\u624D\u751F \u9AD8\u624D\u751F|\u9AD8\u7D1A\u7BA1\u7406\u4EBA\u624D \u9AD8\u7D1A\u7BA1\u7406\u4EBA\u624D|\u9AEE\u91DD \u9AEE\u91DD|\u9B3C\u624D \u9B3C\u624D|\u9B3C\u91DD\u8349 \u9B3C\u91DD\u8349|\u9B5A\u982D\u53C3\u653F \u9B5A\u982D\u53C3\u653F|\u9D3B\u7BC7\u9245\u8457 \u9D3B\u7BC7\u9245\u8457|\u9E7D\u6C34\u91DD \u9E7D\u6C34\u91DD|\u9EB4\u79C0\u624D \u9EB4\u79C0\u624D|\u9EBB\u9189\u91DD \u9EBB\u9189\u91DD|\u9EC3\u6709\u624D \u9EC3\u6709\u624D|\u9EDE\u6838 \u9EDE\u6838|\u9F3B\u91DD\u7642\u6CD5 \u9F3B\u91DD\u7642\u6CD5|\u9F67\u8617\u541E\u91DD \u9F67\u8617\u541E\u91DD";
var h = "\u4E48 \u5E7A|\u507D \u50DE|\u53C3 \u8518|\u5403 \u55AB|\u5507 \u8123|\u555F \u5553|\u5AAF \u5B00|\u5AFB \u5AFA|\u5CF0 \u5CEF|\u5E8A \u7240|\u624D \u7E94|\u6838 \u8988|\u6C59 \u6C61|\u6D29 \u6CC4|\u6E88 \u6F59|\u6F40 \u6F68|\u7076 \u7AC8|\u70BA \u7232|\u75F4 \u7661|\u75FA \u75F9|\u7682 \u7681|\u773E \u8846|\u776A \u777E|\u79D8 \u7955|\u7A1C \u68F1|\u7C37 \u6A90|\u7CBD \u7CC9|\u7F3D \u9262|\u7FA4 \u7FA3|\u8457 \u7740|\u848D \u853F|\u88E1 \u88CF|\u8E34 \u8E0A|\u91DD \u937C|\u97C1 \u7E6E|\u984E \u9F76|\u9BF0 \u9B8E|\u9EB5 \u9EAA";
var p = "A\u578B\u809D\u708E \u7532\u578B\u809D\u708E|A\u809D \u7532\u809D|BMW\u96C6\u5718 \u5BF6\u99AC\u96C6\u5718|B\u578B\u809D\u708E \u4E59\u578B\u809D\u708E|B\u809D \u4E59\u809D|C\u578B\u809D\u708E \u4E19\u578B\u809D\u708E|C\u809D \u4E19\u809D|D\u578B\u809D\u708E \u4E01\u578B\u809D\u708E|D\u809D \u4E01\u809D|E\u578B\u809D\u708E \u620A\u578B\u809D\u708E|E\u809D \u620A\u809D|PN\u63A5\u9762 PN\u7D50|SQL\u96B1\u78BC\u653B\u64CA SQL\u6CE8\u5165|\u4E09\u6975\u9AD4 \u4E09\u6975\u7BA1|\u4E0B\u62C9\u5F0F\u6E05\u55AE \u4E0B\u62C9\u5217\u8868|\u4E19\u80FA\u9178 \u4E19\u6C28\u9178|\u4E1F\u64F2 \u62CB\u51FA|\u4E2D\u4ECB\u8EDF\u9AD4 \u4E2D\u9593\u4EF6|\u4E3B\u6A5F\u677F \u4E3B\u677F|\u4E3B\u958B\u6A5F\u8A18\u9304 \u4E3B\u5F15\u5C0E\u8A18\u9304|\u4E59\u592A\u7DB2 \u4EE5\u592A\u7DB2|\u4E59\u592A\u7DB2\u8DEF \u4EE5\u592A\u7DB2|\u4E59\u592A\u7DB2\u8DEF\u7531\u5668 \u4EE5\u592A\u7DB2\u8DEF\u7531\u5668|\u4E59\u592A\u7DB2\u8DEF\u8DEF\u7531\u5668 \u4EE5\u592A\u7DB2\u8DEF\u7531\u5668|\u4E59\u91AF\u80FA\u915A \u5C0D\u4E59\u9170\u6C28\u57FA\u915A|\u4E73\u916A \u5976\u916A|\u4E8C\u6975\u9AD4 \u4E8C\u6975\u7BA1|\u4E92\u52D5 \u4EA4\u4E92|\u4E92\u52D5\u5F0F \u4EA4\u4E92\u5F0F|\u4E9E\u585E\u62DC\u7136 \u963F\u585E\u62DC\u7586|\u4EAE\u80FA\u9178 \u4EAE\u6C28\u9178|\u4EBA\u5DE5\u667A\u6167 \u4EBA\u5DE5\u667A\u80FD|\u4ECB\u9762 \u754C\u9762|\u4ECB\u9762\u5361 \u9069\u914D\u5668|\u4EE3\u78BC \u4EE3\u78BC|\u4EE3\u8B1D\u75C7\u5019\u7FA4 \u4EE3\u8B1D\u7D9C\u5408\u5FB5|\u4F0A\u5229\u8AFE \u4F0A\u5229\u8AFE\u4F0A|\u4F0A\u5229\u8AFE\u5DDE \u4F0A\u5229\u8AFE\u4F0A\u5DDE|\u4F3A\u670D\u5668 \u670D\u52D9\u5668|\u4F47\u5217 \u968A\u5217|\u4F4D\u5143 \u6BD4\u7279|\u4F4D\u5143\u7387 \u6BD4\u7279\u7387|\u4F4D\u5143\u7D44 \u5B57\u7BC0|\u4F4D\u5143\u901F\u7387 \u78BC\u7387|\u4F4D\u5740 \u5730\u5740|\u4F4D\u5740\u5217 \u5730\u5740\u6B04|\u4F4E\u7D1A \u4F4E\u7D1A|\u4F4E\u968E \u4F4E\u7D1A|\u4F5B\u6F22\xB7\u5A01\u5EC9\u65AF \u6C83\u6069\xB7\u5A01\u5EC9\u65AF|\u4F5B\u745E \u798F\u96F7|\u4F5C\u696D\u7CFB\u7D71 \u64CD\u4F5C\u7CFB\u7D71|\u4F7F\u7528\u8005 \u7528\u6236|\u4F7F\u7528\u8005\u540D\u7A31 \u7528\u6236\u540D|\u4F86\u96FB\u8F49\u63A5 \u547C\u53EB\u8F49\u79FB|\u4F8B\u9805 \u5BE6\u4F8B|\u4FE1\u865F \u4FE1\u865F|\u505C\u7528 \u7981\u7528|\u5075\u932F \u8ABF\u8A66|\u5075\u932F\u7A0B\u5F0F \u8ABF\u8A66\u5668|\u5085\u7ACB\u8449 \u5085\u91CC\u8449|\u50B3\u9001 \u767C\u9001|\u50B7\u5FC3\u5C0F\u68E7 \u7D05\u5FC3\u5927\u6230|\u50F9\u6548\u6BD4 \u6027\u50F9\u6BD4|\u512A\u5148\u9806\u5E8F \u512A\u5148\u7D1A|\u5132\u5B58 \u4FDD\u5B58|\u5143\u4EF6 \u7D44\u4EF6|\u5149\u789F \u5149\u76E4|\u5149\u789F\u6A5F \u5149\u9A45|\u514B\u7F85\u57C3\u897F\u4E9E \u514B\u7F85\u5730\u4E9E|\u514B\u840A\u9580\u7B2C \u514B\u840A\u9580\u8482|\u5165\u53E3\u7DB2\u7AD9 \u9580\u6236\u7DB2\u7AD9|\u5167\u5EFA \u5167\u7F6E|\u5167\u78BC\u8868 \u4EE3\u78BC\u9801|\u5168\u57DF\u6027 \u5168\u5C40|\u5168\u5F62 \u5168\u89D2|\u5168\u7403\u8CC7\u8A0A\u7DB2 \u842C\u7DAD\u7DB2|\u516C\u5143\u7D00\u5E74 \u516C\u5143\u7D00\u5E74|\u51B0\u68D2 \u51B0\u68CD|\u51B7\u76E4 \u6DBC\u83DC|\u51F1\u5409 \u51F1\u5947|\u51FD\u5F0F \u51FD\u6578|\u51FD\u6578\u8A9E\u8A00\u7A0B\u5F0F\u8A2D\u8A08 \u51FD\u6578\u5F0F\u7DE8\u7A0B|\u5200\u92D2\u4F3A\u670D\u5668 \u5200\u7247\u670D\u52D9\u5668|\u5206\u5272\u69FD \u5206\u5340|\u5206\u6563\u5F0F \u5206\u4F48\u5F0F|\u5206\u6642\u591A\u5DE5 \u6642\u5206\u8907\u7528|\u5206\u6642\u591A\u91CD\u9032\u63A5 \u6642\u5206\u591A\u5740|\u5206\u78BC\u591A\u91CD\u9032\u63A5 \u78BC\u5206\u591A\u5740|\u5206\u7A7A\u9593\u591A\u91CD\u9032\u63A5 \u7A7A\u5206\u591A\u5740|\u5206\u983B\u591A\u5DE5 \u983B\u5206\u8907\u7528|\u5206\u983B\u591A\u91CD\u9032\u63A5 \u983B\u5206\u591A\u5740|\u5217\u5370 \u6253\u5370|\u5217\u652F\u6566\u65AF\u767B \u5217\u652F\u6566\u58EB\u767B|\u5217\u8209 \u679A\u8209|\u5229\u84CB\u608C \u5229\u84CB\u8482|\u524D\u8655\u7406\u5668 \u9810\u8655\u7406\u5668|\u526A\u4E0B \u526A\u5207|\u526A\u8CBC\u7C3F \u526A\u8CBC\u677F|\u526F\u6A94\u540D \u64F4\u5C55\u540D|\u52A0\u5F6D \u52A0\u84EC|\u5305\u7F85\u5B9A \u9B91\u7F85\u4E01|\u5317\u5361\u7F85\u840A\u7D0D \u5317\u5361\u7F85\u4F86\u7D0D|\u5317\u5361\u7F85\u840A\u7D0D\u5DDE \u5317\u5361\u7F85\u4F86\u7D0D\u5DDE|\u5317\u99AC\u5229\u5B89\u7D0D \u5317\u99AC\u91CC\u4E9E\u7D0D|\u5317\u99AC\u5229\u5B89\u7D0D\u7FA4\u5CF6 \u5317\u99AC\u91CC\u4E9E\u7D0D\u7FA3\u5CF6|\u532F\u5165 \u5C0E\u5165|\u532F\u51FA \u5C0E\u51FA|\u532F\u6D41\u6392 \u7E3D\u7DDA|\u5340\u57DF\u6027 \u5C40\u90E8|\u5340\u57DF\u7DB2 \u5C40\u57DF\u7DB2|\u5343\u91CC\u9054\u53CA\u6258\u5DF4\u54E5 \u7279\u7ACB\u5C3C\u9054\u548C\u591A\u5DF4\u54E5|\u534A\u5F62 \u534A\u89D2|\u5357\u5361\u7F85\u840A\u7D0D \u5357\u5361\u7F85\u4F86\u7D0D|\u5357\u5361\u7F85\u840A\u7D0D\u5DDE \u5357\u5361\u7F85\u4F86\u7D0D\u5DDE|\u5361\u9054 \u5361\u5854\u723E|\u5370\u8868\u6A5F \u6253\u5370\u6A5F|\u5373\u6642 \u5BE6\u6642|\u5384\u5229\u5782\u4E9E \u5384\u7ACB\u7279\u91CC\u4E9E|\u5384\u74DC\u591A \u5384\u74DC\u591A\u723E|\u539F\u59CB\u6A94 \u6E90\u6587\u4EF6|\u539F\u59CB\u78BC \u6E90\u4EE3\u78BC|\u539F\u751F\u4EE3\u78BC \u672C\u5730\u4EE3\u78BC|\u53C3\u6578\u5217 \u53C3\u6578\u8868|\u53D6\u6A23 \u63A1\u6A23|\u53D6\u6A23\u7387 \u63A1\u6A23\u7387|\u53E2\u96C6 \u96C6\u7FA3|\u53EE\u53EE\u5679 \u4E01\u4E01\u7576|\u53EE\u53EE\u5679\u5679 \u4E01\u4E01\u7576\u7576|\u53EE\u5679 \u4E01\u7576|\u53F0\u7A4D\u516C\u53F8 \u81FA\u7A4D\u516C\u53F8|\u53F0\u7A4D\u96FB \u81FA\u7A4D\u96FB|\u53F2\u4ED6\u6C40\u985E \u4ED6\u6C40\u985E|\u53F2\u514B\u91CC\u4E9E\u8CD3 \u65AF\u514B\u91CC\u4E9E\u8CD3|\u53F2\u5361\u62C9\u7B2C \u65AF\u5361\u62C9\u8482|\u53F2\u6258\u514B\u8C6A\u68EE \u65BD\u6258\u514B\u8C6A\u68EE|\u53F2\u7279\u52DE\u65AF \u65BD\u7279\u52DE\u65AF|\u53F2\u7279\u62C9\u6C76\u65AF\u57FA \u65AF\u7279\u62C9\u6587\u65AF\u57FA|\u53F2\u74E6\u6FDF\u862D \u65AF\u5A01\u58EB\u862D|\u53F2\u9EA5\u5854\u7D0D \u65AF\u7F8E\u5854\u90A3|\u53F8\u6CD5\u7A0B\u5E8F \u53F8\u6CD5\u7A0B\u5E8F|\u5409\u5E03\u5730 \u5409\u5E03\u5824|\u5409\u91CC\u5DF4\u65AF \u57FA\u91CC\u5DF4\u65AF|\u540D\u5B57\u7A7A\u9593 \u547D\u540D\u7A7A\u9593|\u540D\u7A31\u7A7A\u9593 \u547D\u540D\u7A7A\u9593|\u5410\u74E6\u9B6F \u5716\u74E6\u76E7|\u5411\u91CF \u77E2\u91CF|\u547C\u53EB \u8ABF\u7528|\u547D\u4EE4\u5217 \u547D\u4EE4\u884C|\u5496\u54E9 \u5496\u55B1|\u54C8\u85A9\u514B \u54C8\u85A9\u514B\u65AF\u5766|\u54E5\u65AF\u5927\u9ECE\u52A0 \u54E5\u65AF\u9054\u9ECE\u52A0|\u5510\u6C0F\u75C7 \u5510\u6C0F\u7D9C\u5408\u5FB5|\u555F\u7528 \u6FC0\u6D3B|\u55AC\u6CBB\u4E9E \u55AC\u6CBB\u4E9E|\u55AC\u6CBB\u4E9E\u5171\u548C\u570B \u683C\u9B6F\u5409\u4E9E\u5171\u548C\u570B|\u55AC\u6CBB\u4E9E\u5DDE \u4F50\u6CBB\u4E9E\u5DDE|\u55AE\u6838\u5FC3 \u5B8F\u5167\u6838|\u56DE\u64A5 \u56DE\u8ABF|\u5716\u793A \u5716\u6A19|\u571F\u5EAB\u66FC \u571F\u5EAB\u66FC\u65AF\u5766|\u5730\u5740 \u5730\u5740|\u5766\u5C1A\u5C3C\u4E9E \u5766\u6851\u5C3C\u4E9E|\u578B\u5225 \u985E\u578B|\u57E0 \u7AEF\u53E3|\u57F7\u884C \u904B\u884C|\u57F7\u884C\u6A94 \u53EF\u57F7\u884C\u6587\u4EF6|\u57F7\u884C\u7DD2 \u7DDA\u7A0B|\u57F7\u884C\u9577 \u9996\u5E2D\u57F7\u884C\u5B98|\u5806\u758A \u5806\u68E7|\u5834\u6548\u96FB\u6676\u9AD4 \u5834\u6548\u61C9\u7BA1|\u5851\u81A0 \u5851\u6599|\u5854\u5409\u514B \u5854\u5409\u514B\u65AF\u5766|\u585E\u5E2D\u723E \u585E\u820C\u723E|\u585E\u666E\u52D2\u65AF \u585E\u6D66\u8DEF\u65AF|\u58C1\u7D19 \u58C1\u7D19|\u590F\u8FB2 \u9999\u8FB2|\u5916\u639B \u63D2\u4EF6|\u5916\u63A5 \u5916\u7F6E|\u5916\u90E8\u7D22\u5F15\u9375 \u5916\u9375|\u591A\u56CA\u6027\u5375\u5DE2\u75C7\u5019\u7FA4 \u591A\u56CA\u5375\u5DE2\u7D9C\u5408\u5FB5|\u591A\u578B \u591A\u614B|\u591A\u57F7\u884C\u7DD2 \u591A\u7DDA\u7A0B|\u591A\u5C3C\u91C7\u7B2C \u591A\u5C3C\u91C7\u8482|\u591A\u5DE5 \u591A\u4EFB\u52D9|\u591A\u660E\u5C3C\u52A0 \u591A\u7C73\u5C3C\u52A0|\u5927\u6578\u64DA \u5927\u6578\u64DA|\u5927\u8178\u6FC0\u8E81\u75C7 \u8178\u6613\u6FC0\u7D9C\u5408\u5FB5|\u5929\u51AC\u80FA\u9178 \u5929\u51AC\u6C28\u9178|\u5929\u51AC\u91AF\u80FA \u5929\u51AC\u9170\u80FA|\u5929\u9580\u51AC\u80FA\u9178 \u5929\u9580\u51AC\u6C28\u9178|\u5929\u9580\u51AC\u91AF\u80FA \u5929\u9580\u51AC\u9170\u80FA|\u592A\u7A7A\u68AD \u822A\u5929\u98DB\u6A5F|\u5931\u667A\u75C7 \u7661\u5446\u75C7|\u5948\u53CA\u5229\u4E9E \u5C3C\u65E5\u5229\u4E9E|\u5948\u7C73 \u7D0D\u7C73|\u5967\u514B\u62C9\u8377\u99AC \u4FC4\u514B\u62C9\u4F55\u99AC|\u5967\u514B\u62C9\u8377\u99AC\u57CE \u4FC4\u514B\u62C9\u4F55\u99AC\u57CE|\u5967\u514B\u62C9\u8377\u99AC\u5DDE \u4FC4\u514B\u62C9\u4F55\u99AC\u5DDE|\u5967\u514B\u62C9\u8377\u99AC\u5E02 \u4FC4\u514B\u62C9\u4F55\u99AC\u5E02|\u5967\u52D2\u5CA1 \u4FC4\u52D2\u5CA1|\u5967\u52D2\u5CA1\u5DDE \u4FC4\u52D2\u5CA1\u5DDE|\u5967\u798F \u5967\u723E\u592B|\u597D\u5E02\u591A \u958B\u5E02\u5BA2|\u597D\u5E02\u591A\u516C\u53F8 \u958B\u5E02\u5BA2\u516C\u53F8|\u59A5\u745E\u6C0F\u75C7 \u62BD\u52D5\u7A62\u8A9E\u7D9C\u5408\u5FB5|\u59A5\u745E\u75C7 \u62BD\u52D5\u7A62\u8A9E\u7D9C\u5408\u5FB5|\u5A01\u65AF\u5EB7\u8F9B \u5A01\u65AF\u5EB7\u661F|\u5A01\u65AF\u5EB7\u8F9B\u5DDE \u5A01\u65AF\u5EB7\u661F\u5DDE|\u5B0C\u751F\u516C\u53F8 \u5F37\u751F\u516C\u53F8|\u5B50\u97F3 \u8F14\u97F3|\u5B57\u4E32 \u5B57\u7B26\u4E32|\u5B57\u5143 \u5B57\u7B26|\u5B57\u5143\u96C6 \u5B57\u7B26\u96C6|\u5B57\u578B \u5B57\u9AD4|\u5B57\u578B\u6A94 \u5B57\u5EAB|\u5B57\u5C3E \u5F8C\u7DB4|\u5B57\u7BC0\u8DF3\u52D5 \u5B57\u7BC0\u8DF3\u52D5|\u5B57\u9996 \u524D\u7DB4|\u5B58\u53D6 \u8A2A\u554F|\u5B58\u6A94 \u5B58\u76E4|\u5B5F\u5FB7\u723E\u980C \u9580\u5FB7\u723E\u677E|\u5B89\u5730\u5361\u53CA\u5DF4\u5E03\u9054 \u5B89\u63D0\u74DC\u548C\u5DF4\u5E03\u9054|\u5B89\u6BD4\u897F\u6797 \u6C28\u82C4\u897F\u6797|\u5B89\u83AB\u897F\u6797 \u963F\u83AB\u897F\u6797|\u5B8F\u90FD\u62C9\u65AF \u6D2A\u90FD\u62C9\u65AF|\u5B95\u6A5F \u6B7B\u6A5F|\u5B9A\u5740 \u5C0B\u5740|\u5BA3\u544A \u8072\u660E|\u5BC6\u897F\u6839 \u5BC6\u6B47\u6839|\u5BC6\u897F\u6839\u5DDE \u5BC6\u6B47\u6839\u5DDE|\u5BE6\u4F8B \u5BE6\u4F8B|\u5BE6\u9AD4\u5730\u5740 \u7269\u7406\u5730\u5740|\u5BE6\u9AD4\u8A18\u61B6\u9AD4 \u7269\u7406\u5167\u5B58|\u5BEC\u983B \u5BEC\u5E36|\u5BEE\u570B \u8001\u64BE|\u5BF6\u50D1 \u5BF6\u6F54|\u5BF6\u50D1\u516C\u53F8 \u5BF6\u6F54\u516C\u53F8|\u5C08\u6848 \u9805\u76EE|\u5C0D\u4E59\u91AF\u80FA\u57FA\u915A \u5C0D\u4E59\u9170\u6C28\u57FA\u915A|\u5C0D\u6620 \u6620\u5C04|\u5C0D\u8A71\u65B9\u584A \u5C0D\u8A71\u6846|\u5C0D\u8C61 \u5C0D\u8C61|\u5C1A\u6BD4\u4E9E \u8D0A\u6BD4\u4E9E|\u5C24\u62C9 \u6B50\u62C9|\u5C3C\u65E5 \u5C3C\u65E5\u723E|\u5DE2\u72C0 \u5D4C\u5957|\u5DE5\u4F5C\u5217 \u4EFB\u52D9\u6B04|\u5DE5\u4F5C\u7BA1\u7406\u54E1 \u4EFB\u52D9\u7BA1\u7406\u5668|\u5DE8\u96C6 \u5B8F|\u5DE8\u96C6\u51FD\u5F0F \u5B8F\u51FD\u6578|\u5DE8\u96C6\u547C\u53EB \u5B8F\u8ABF\u7528|\u5DE8\u96C6\u547D\u4EE4 \u5B8F\u547D\u4EE4|\u5DE8\u96C6\u5B9A\u7FA9 \u5B8F\u5B9A\u7FA9|\u5DE8\u96C6\u5C55\u958B \u5B8F\u5C55\u958B|\u5DE8\u96C6\u6307\u4EE4 \u5B8F\u6307\u4EE4|\u5DE8\u96C6\u66FF\u63DB \u5B8F\u66FF\u63DB|\u5DE8\u96C6\u7A0B\u5F0F\u8A2D\u8A08 \u5B8F\u7DE8\u7A0B|\u5DE8\u96C6\u8655\u7406 \u5B8F\u8655\u7406|\u5DE8\u96C6\u8A9E\u8A00 \u5B8F\u8A9E\u8A00|\u5DF4\u5E03\u4E9E\u7D10\u5E7E\u5167\u4E9E \u5DF4\u5E03\u4E9E\u65B0\u5E7E\u5167\u4E9E|\u5DF4\u8C9D\u591A \u5DF4\u5DF4\u591A\u65AF|\u5DF4\u91D1\u68EE\u6C0F\u75C7 \u5E15\u91D1\u68EE\u75C5|\u5E02\u5834\u884C\u92B7 \u5E02\u5834\u71DF\u92B7|\u5E03\u5217\u6566 \u5E03\u96F7\u9813|\u5E03\u5217\u6566\u68EE\u6797 \u5E03\u96F7\u9813\u68EE\u6797|\u5E03\u5217\u6566\u68EE\u6797\u5236\u5EA6 \u5E03\u96F7\u9813\u68EE\u6797\u9AD4\u7CFB|\u5E03\u5409\u7D0D\u6CD5\u7D22 \u5E03\u57FA\u7D0D\u6CD5\u7D22|\u5E03\u62C9\u59C6\u65AF \u52C3\u62C9\u59C6\u65AF|\u5E03\u6797 \u5E03\u723E|\u5E03\u745E\u9813 \u5E03\u91CC\u9813|\u5E03\u840A\u8332 \u5E03\u5217\u8332|\u5E15\u91D1\u68EE\u6C0F\u75C7 \u5E15\u91D1\u68EE\u75C5|\u5E1B\u7409 \u5E15\u52DE|\u5E73\u884C\u8A08\u7B97 \u4E26\u884C\u8A08\u7B97|\u5E7E\u5167\u4E9E\u6BD4\u7D22 \u5E7E\u5167\u4E9E\u6BD4\u7D39|\u5E8F\u5217 \u4E32\u884C|\u5E8F\u5217\u57E0 \u4E32\u53E3|\u5E8F\u865F\u7522\u751F\u5668 \u8A3B\u518A\u6A5F|\u5EAB\u6B23\u6C0F\u75C7\u5019\u7FA4 \u5EAB\u6B23\u7D9C\u5408\u5FB5|\u5EB7\u4E43\u72C4\u514B \u5EB7\u6D85\u72C4\u683C|\u5EB7\u4E43\u72C4\u514B\u5DDE \u5EB7\u6D85\u72C4\u683C\u5DDE|\u5EFA\u69CB\u51FD\u5F0F \u69CB\u9020\u51FD\u6578|\u5EFA\u69CB\u5B50 \u69CB\u9020\u5668|\u5EFA\u7ACB \u5275\u5EFA|\u5F15\u6578 \u53C3\u6578|\u5F59\u7DE8 \u5F59\u7DE8|\u5F69\u8272\u8D85\u97F3\u6CE2 \u5F69\u8D85|\u5F71\u50CF \u5716\u50CF|\u5F71\u5370 \u8907\u5370|\u5F71\u7247 \u8996\u983B|\u5F8C\u5929\u514D\u75AB\u7F3A\u4E4F\u75C7\u5019\u7FA4 \u7372\u5F97\u6027\u514D\u75AB\u7F3A\u9677\u7D9C\u5408\u5FB5|\u5F8C\u8A2D\u8CC7\u6599 \u5143\u6578\u64DA|\u5FAA\u74B0 \u5FAA\u74B0|\u5FAE\u63A7\u5236\u5668 \u55AE\u7247\u6A5F|\u5FB7\u5E03\u897F \u5FB7\u5F6A\u897F|\u5FB7\u5F17\u672D\u514B \u5FB7\u6C83\u590F\u514B|\u5FB7\u62C9\u74E6 \u7279\u62C9\u83EF|\u5FB7\u62C9\u74E6\u5DDE \u7279\u62C9\u83EF\u5DDE|\u5FC3\u5BA4\u986B\u52D5 \u5FC3\u5BA4\u986B\u52D5|\u5FC3\u623F\u64B2\u52D5 \u5FC3\u623F\u64B2\u52D5|\u5FC3\u623F\u986B\u52D5 \u5FC3\u623F\u986B\u52D5|\u5FC3\u808C\u6897\u585E \u5FC3\u808C\u6897\u6B7B|\u5FEB\u53D6 \u7DE9\u5B58|\u5FEB\u53D6\u8A18\u61B6\u9AD4 \u9AD8\u901F\u7DE9\u5B58|\u5FEB\u6377\u534A\u5C0E\u9AD4 \u4ED9\u7AE5\u534A\u5C0E\u9AD4|\u5FEB\u9583\u8A18\u61B6\u9AD4 \u9583\u5B58|\u6025\u6027\u547C\u5438\u7A98\u8FEB\u75C7\u5019\u7FA4 \u6025\u6027\u547C\u5438\u7A98\u8FEB\u7D9C\u5408\u5FB5|\u611B\u6ECB\u75C5 \u827E\u6ECB\u75C5|\u611B\u6ECB\u75C5\u60A3 \u827E\u6ECB\u75C5\u4EBA|\u611B\u6ECB\u75C5\u6BD2 \u827E\u6ECB\u75C5\u6BD2|\u611B\u8377\u83EF \u827E\u5967\u74E6|\u611B\u8377\u83EF\u5DDE \u827E\u5967\u74E6\u5DDE|\u611F\u6E2C \u50B3\u611F|\u6162\u6027\u75B2\u52DE\u75C7\u5019\u7FA4 \u6162\u6027\u75B2\u52DE\u7D9C\u5408\u5FB5|\u6182\u9B31\u75C7 \u6291\u9B31\u75C7|\u6212\u65B7\u75C7\u5019\u7FA4 \u6212\u65B7\u7D9C\u5408\u5FB5|\u622A\u5716 \u622A\u5C4F|\u6234\u5967\u8F9B \u4E8C\u5641\u82F1|\u6234\u6D41\u58EB \u6234\u7559\u65AF|\u6253\u958B \u6253\u958B|\u6279\u6B21 \u6279\u91CF|\u6280\u8853\u9577 \u9996\u5E2D\u6280\u8853\u5B98|\u62C9\u6469 \u62C9\u83AB|\u62C9\u7F85 \u62C9\u6D1B|\u62C9\u8D6B\u66FC\u5C3C\u8AFE\u592B \u62C9\u8D6B\u746A\u5C3C\u8AFE\u592B|\u6307\u4EE4\u5F0F\u7A0B\u5F0F\u8A2D\u8A08 \u547D\u4EE4\u5F0F\u7DE8\u7A0B|\u6307\u4EE4\u78BC \u8173\u672C|\u6307\u6A19 \u6307\u91DD|\u6372\u8EF8 \u6EFE\u52D5\u689D|\u6383\u63CF\u5668 \u6383\u63CF\u5100|\u6392\u7A0B \u8ABF\u5EA6|\u63A7\u5236\u4EE3\u78BC \u53E5\u67C4|\u63A7\u5236\u5143\u4EF6 \u63A7\u4EF6|\u63D0\u4F69\u7279 \u8482\u4F69\u7279|\u641C\u5C0B \u641C\u7D22|\u6469\u723E\u7DDA\u7A0B \u6469\u723E\u7DDA\u7A0B|\u647A\u7A4D \u6372\u7A4D|\u64A5\u51FA \u547C\u51FA|\u64F4\u5145\u5957\u4EF6 \u64F4\u5C55|\u64F4\u97F3 \u514D\u63D0|\u64F7\u53D6 \u622A\u53D6|\u651C\u5E36\u578B \u4FBF\u651C\u5F0F|\u651D\u8B77\u817A \u524D\u5217\u817A|\u652F\u6301\u8005 \u652F\u6301\u8005|\u652F\u63F4 \u652F\u6301|\u6548\u80FD \u6027\u80FD|\u6574\u5408 \u96C6\u6210|\u6578\u4F4D \u6578\u5B57|\u6578\u4F4D\u5370\u5237 \u6578\u5B57\u5370\u5237|\u6578\u4F4D\u96FB\u5B50 \u6578\u5B57\u96FB\u5B50|\u6578\u4F4D\u96FB\u8DEF \u6578\u5B57\u96FB\u8DEF|\u6578\u5B57 \u6578\u5B57|\u6578\u64DA \u6578\u64DA|\u6578\u64DA\u6A5F \u8ABF\u88FD\u89E3\u8ABF\u5668|\u6587\u4EF6 \u6587\u6A94|\u6587\u66F8\u8655\u7406 \u6587\u5B57\u8655\u7406|\u65AF\u6D1B\u7DAD\u5C3C\u4E9E \u65AF\u6D1B\u6587\u5C3C\u4E9E|\u65B0\u589E \u6DFB\u52A0|\u65B0\u7F55\u5E03\u590F \u65B0\u7F55\u5E03\u4EC0\u723E|\u65B0\u7F55\u5E03\u590F\u5DDE \u65B0\u7F55\u5E03\u4EC0\u723E\u5DDE|\u65B9\u7A0B\u5F0F \u65B9\u7A0B\u5F0F|\u6620\u8C61 \u93E1\u50CF|\u6620\u8C61\u7BA1 \u986F\u50CF\u7BA1|\u6642\u8108\u983B\u7387 \u6642\u9418\u983B\u7387|\u666E\u7F85\u9AD8\u83F2\u592B \u666E\u7F85\u79D1\u83F2\u8036\u592B|\u666E\u8CFD\u723E \u73C0\u585E\u723E|\u6676\u7247 \u82AF\u7247|\u667A\u6167 \u667A\u80FD|\u667A\u6167\u8CA1\u7522\u6B0A \u77E5\u8B58\u7522\u6B0A|\u66AB\u5B58\u5668 \u5BC4\u5B58\u5668|\u6700\u4F73\u5316 \u512A\u5316|\u6709\u5931\u771F\u58D3\u7E2E \u6709\u640D\u58D3\u7E2E|\u6797\u59C6\u65AF\u57FA-\u9AD8\u6C99\u53EF\u592B \u91CC\u59C6\u65AF\u57FA-\u79D1\u85A9\u79D1\u592B|\u67E5\u5FB7 \u4E4D\u5F97|\u67E5\u8A62 \u67E5\u627E|\u67EF\u666E\u862D \u79D1\u666E\u862D|\u67EF\u96F7\u5229 \u79D1\u96F7\u5229|\u6838\u53D6\u6309\u9215 \u8907\u9078\u6309\u9215|\u6838\u53D6\u65B9\u584A \u8907\u9078\u6846|\u6838\u5FC3 \u5167\u6838|\u683C\u745E\u90A3\u9054 \u683C\u6797\u7D0D\u9054|\u684C\u4E0A\u578B \u684C\u9762\u578B|\u684C\u4E0A\u578B\u96FB\u8166 \u81FA\u5F0F\u6A5F|\u684C\u5E03 \u58C1\u7D19|\u6885\u6E58 \u6885\u897F\u5B89|\u694A\u7D0D\u5091\u514B \u96C5\u7D0D\u5207\u514B|\u69B4\u69E4 \u69B4\u84EE|\u6A19\u982D\u6A94\u6848 \u982D\u6587\u4EF6|\u6A21\u64EC \u6A21\u64EC|\u6A21\u7D44 \u6A21\u584A|\u6A21\u91CC\u897F\u65AF \u6BDB\u91CC\u6C42\u65AF|\u6A5F\u7387 \u6982\u7387|\u6A94\u540D \u6587\u4EF6\u540D|\u6A94\u6848 \u6587\u4EF6|\u6AA2\u8996 \u67E5\u770B|\u6B04\u4F4D \u5B57\u6BB5|\u6B50\u5DF4\u99AC \u5967\u5DF4\u99AC|\u6B63\u5B50 \u6B63\u96FB\u5B50|\u6B63\u5B50\u65B7\u5C64\u9020\u5F71 \u6B63\u96FB\u5B50\u767C\u5C04\u8A08\u7B97\u6A5F\u65B7\u5C64|\u6B63\u7576\u7A0B\u5E8F \u6B63\u7576\u7A0B\u5E8F|\u6B63\u898F\u5316 \u7BC4\u5F0F|\u6B63\u898F\u8868\u793A\u5F0F \u6B63\u5247\u8868\u9054\u5F0F|\u6BCD\u97F3 \u5143\u97F3|\u6BD4\u7279\u5E63 \u6BD4\u7279\u5E63|\u6C23\u6CE1\u6392\u5E8F \u5192\u6CE1\u6392\u5E8F|\u6C38\u73CD \u842C\u8C61|\u6C38\u7E8C\u6027 \u6301\u4E45\u6027|\u6C76\u840A \u6587\u840A|\u6C99\u70CF\u5730\u963F\u62C9\u4F2F \u6C99\u7279\u963F\u62C9\u4F2F|\u6C99\u70CF\u5730\u963F\u7F8E \u6C99\u7279\u963F\u7F8E|\u6C99\u70CF\u5730\u963F\u7F8E\u516C\u53F8 \u6C99\u7279\u963F\u7F8E\u516C\u53F8|\u6CE1\u9EB5 \u65B9\u4FBF\u9EAA|\u6CE2\u514B\u590F\u6D77\u745F\u5A01 \u4F2F\u514B\u5E0C\u723E\u54C8\u6492\u97CB|\u6CE2\u514B\u590F\u6D77\u745F\u5A01\u516C\u53F8 \u4F2F\u514B\u5E0C\u723E\u54C8\u6492\u97CB\u516C\u53F8|\u6CE2\u51F1\u91CC\u5C3C \u535A\u51F1\u91CC\u5C3C|\u6CE2\u58EB\u5C3C\u4E9E\u8D6B\u585E\u54E5\u7DAD\u7D0D \u6CE2\u65AF\u5C3C\u4E9E\u9ED1\u585E\u54E5\u7DAD\u90A3|\u6CE2\u672D\u90A3 \u535A\u8328\u74E6\u7D0D|\u6CE2\u9577\u5206\u6CE2\u591A\u5DE5 \u6CE2\u5206\u8907\u7528|\u6D77\u5167\u5B58\u77E5\u5DF1 \u6D77\u5167\u5B58\u77E5\u5DF1|\u6D77\u98DB\u8332 \u6D77\u83F2\u8328|\u6D88\u606F \u6D88\u606F|\u6E38\u6A19 \u5149\u6A19|\u6EA2\u4F4D \u6EA2\u51FA|\u6ED1\u9F20 \u9F20\u6A19|\u6F14\u7B97\u6CD5 \u7B97\u6CD5|\u6F22\u4ED6\u75C5\u6BD2 \u6F22\u5766\u75C5\u6BD2|\u6F58\u5FB7\u5217\u8332\u57FA \u6F58\u5FB7\u5217\u8328\u57FA|\u70CF\u8332\u5225\u514B \u70CF\u8332\u5225\u514B\u65AF\u5766|\u7121\u5931\u771F\u58D3\u7E2E \u7121\u640D\u58D3\u7E2E|\u71D2\u9304 \u523B\u9304|\u71DF\u904B\u9577 \u9996\u5E2D\u904B\u71DF\u5B98|\u7247\u8A9E \u8A5E\u7D44|\u7269\u4EF6 \u5C0D\u8C61|\u7269\u4EF6\u5C0E\u5411 \u9762\u5411\u5C0D\u8C61|\u72C0\u614B\u5217 \u72C0\u614B\u6B04|\u7345\u5B50\u5C71 \u585E\u62C9\u5229\u6602|\u74DC\u5730\u99AC\u62C9 \u5371\u5730\u99AC\u62C9|\u7518\u6BD4\u4E9E \u5CA1\u6BD4\u4E9E|\u7518\u80FA\u9178 \u7518\u6C28\u9178|\u7532\u786B\u80FA\u9178 \u7532\u786B\u6C28\u9178|\u756B\u7D20 \u50CF\u7D20|\u7570\u4EAE\u80FA\u9178 \u7570\u4EAE\u6C28\u9178|\u7570\u767D\u80FA\u9178 \u7570\u4EAE\u6C28\u9178|\u767B\u5165 \u767B\u9304|\u767B\u51FA \u8A3B\u92B7|\u767B\u9304\u6A94 \u8A3B\u518A\u8868|\u767D\u80FA\u9178 \u4EAE\u6C28\u9178|\u767D\u8840\u7403 \u767D\u7D30\u80DE|\u767D\u907C\u58EB \u67CF\u907C\u8332|\u76E7\u5B89\u9054 \u76E7\u65FA\u9054|\u76EE\u7684\u78BC \u76EE\u6A19\u4EE3\u78BC|\u76F4\u8B6F\u5668 \u89E3\u91CB\u5668|\u76F8\u5BB9 \u517C\u5BB9|\u76F8\u7C3F \u76F8\u518A|\u771F\u5BE6\u6A21\u5F0F \u5BE6\u6A21\u5F0F|\u7761\u7720\u547C\u5438\u4E2D\u6B62\u75C7 \u7761\u7720\u547C\u5438\u66AB\u505C\u7D9C\u5408\u5FB5|\u77FD \u7845|\u7808 \u7839|\u7834\u5716 \u82B1\u5C4F|\u786C\u789F \u786C\u76E4|\u786C\u9AD4 \u786C\u4EF6|\u789F\u7247 \u76E4\u7247|\u78C1\u789F \u78C1\u76E4|\u78C1\u789F\u6A5F\u4EE3\u865F \u76E4\u7B26|\u78C1\u8ECC \u78C1\u9053|\u793E\u5340 \u793E\u5340|\u793E\u7FA4 \u793E\u5340|\u798F\u65AF\u6C7D\u8ECA \u5927\u8846\u6C7D\u8ECA|\u798F\u65AF\u6C7D\u8ECA\u96C6\u5718 \u5927\u8846\u6C7D\u8ECA\u96C6\u5718|\u798F\u65AF\u96C6\u5718 \u5927\u8846\u96C6\u5718|\u7A0B\u5E8F \u9032\u7A0B|\u7A0B\u5E8F\u4E0D\u6B63\u7FA9 \u7A0B\u5E8F\u4E0D\u6B63\u7FA9|\u7A0B\u5E8F\u5C0E\u5411 \u9762\u5411\u904E\u7A0B|\u7A0B\u5E8F\u5F0F\u7A0B\u5F0F\u8A2D\u8A08 \u904E\u7A0B\u5F0F\u7DE8\u7A0B|\u7A0B\u5E8F\u6B63\u7FA9 \u7A0B\u5E8F\u6B63\u7FA9|\u7A0B\u5F0F \u7A0B\u5E8F|\u7A0B\u5F0F\u78BC \u4EE3\u78BC|\u7A0B\u5F0F\u8A2D\u8A08 \u7DE8\u7A0B|\u7A0B\u5F0F\u8A2D\u8A08\u5E2B \u7A0B\u5E8F\u54E1|\u7A0B\u5F0F\u8A9E\u8A00 \u7DE8\u7A0B\u8A9E\u8A00|\u7A3D\u6838 \u5BE9\u8988|\u7A40\u6C28\u91AF\u80FA \u7A40\u6C28\u9170\u80FA|\u7A40\u80FA\u9178 \u7A40\u6C28\u9178|\u7A46\u7D22\u65AF\u57FA \u7A46\u7D22\u723E\u65AF\u57FA|\u7A4D\u9AD4\u96FB\u8DEF \u96C6\u6210\u96FB\u8DEF|\u7A7A\u6C23\u6E05\u6DE8\u6A5F \u7A7A\u6C23\u6DE8\u5316\u5668|\u7A7A\u9593\u591A\u5DE5 \u7A7A\u5206\u8907\u7528|\u7A81\u5C3C\u897F\u4E9E \u7A81\u5C3C\u65AF|\u7B46\u8A18\u578B\u96FB\u8166 \u7B46\u8A18\u672C\u96FB\u8166|\u7BC4\u5F0F \u7BC4\u5F0F|\u7C21\u5831 \u6F14\u793A\u6587\u7A3F|\u7C21\u8A0A \u77ED\u4FE1|\u7C3D\u5E33\u91D1\u878D\u5361 \u501F\u8A18\u5361|\u7C98\u8CBC \u7C98\u8CBC|\u7CBE\u80FA\u9178 \u7CBE\u6C28\u9178|\u7D05\u8840\u7403 \u7D05\u7D30\u80DE|\u7D0D\u7C73\u6BD4\u4E9E \u7D0D\u7C73\u6BD4\u4E9E|\u7D10\u6FA4\u897F \u65B0\u6FA4\u897F|\u7D10\u6FA4\u897F\u5DDE \u65B0\u6FA4\u897F\u5DDE|\u7D10\u897F\u862D \u65B0\u897F\u862D|\u7D22\u7F85\u9580\u7FA4\u5CF6 \u6240\u7F85\u9580\u7FA3\u5CF6|\u7D22\u99AC\u5229\u4E9E \u7D22\u99AC\u91CC|\u7D42\u7AEF\u4F7F\u7528\u8005 \u6700\u7D42\u7528\u6236|\u7D44\u5408\u8A9E\u8A00 \u5F59\u7DE8\u8A9E\u8A00|\u7D44\u80FA\u9178 \u7D44\u6C28\u9178|\u7D44\u8B6F \u5F59\u7DE8|\u7D44\u8B6F\u5668 \u5F59\u7DE8\u5668|\u7D50\u675F\u901A\u8A71 \u639B\u65B7|\u7D72\u80FA\u9178 \u7D72\u6C28\u9178|\u7D81\u67B6\u4E01\u4E01\u7576 \u7D81\u67B6\u4E01\u4E01\u7576|\u7D93\u524D\u75C7\u5019\u7FA4 \u7D93\u524D\u671F\u7D9C\u5408\u5FB5|\u7DAD\u5409\u5C3C\u4E9E \u5F17\u5409\u5C3C\u4E9E|\u7DAD\u5409\u5C3C\u4E9E\u5DDE \u5F17\u5409\u5C3C\u4E9E\u5DDE|\u7DAD\u5FB7\u89D2 \u4F5B\u5F97\u89D2|\u7DB2\u5496 \u7DB2\u5427|\u7DB2\u7D61\u5361 \u7DB2\u5361|\u7DB2\u8DEF \u7DB2\u7D61|\u7DB2\u8DEF\u4E0A\u7684\u82B3\u9130 \u7DB2\u4E0A\u9130\u5C45|\u7DB2\u969B\u7DB2\u8DEF \u4E92\u806F\u7DB2|\u7DDA\u4E0A \u5728\u7DDA|\u7E2E\u5716 \u7E2E\u7565\u5716|\u7E2E\u6392 \u7E2E\u9032|\u7E6B\u7D50 \u7D81\u5B9A|\u7E88\u80FA\u9178 \u7E88\u6C28\u9178|\u7F85\u5FB7\u5CF6 \u7F85\u5F97\u5CF6|\u7F85\u5FB7\u5CF6\u5DDE \u7F85\u5F97\u5CF6\u5DDE|\u7F8E\u5C6C\u7DAD\u4EAC\u7FA4\u5CF6 \u7F8E\u5C6C\u7DAD\u723E\u4EAC\u7FA3\u5CF6|\u7FA9\u5927\u5229 \u610F\u5927\u5229|\u8001\u5E74\u5931\u667A\u75C7 \u8001\u5E74\u7661\u5446\u75C7|\u8056\u514B\u91CC\u65AF\u591A\u798F\u53CA\u5C3C\u7DAD\u65AF \u8056\u57FA\u8328\u548C\u5C3C\u7DAD\u65AF|\u8056\u6587\u68EE\u53CA\u683C\u745E\u90A3\u4E01 \u8056\u6587\u68EE\u7279\u548C\u683C\u6797\u7D0D\u4E01\u65AF|\u8056\u9732\u897F\u4E9E \u8056\u76E7\u897F\u4E9E|\u8056\u99AC\u5229\u8AFE \u8056\u99AC\u529B\u8AFE|\u806F\u7D50\u5668 \u9023\u63A5\u5668|\u806F\u7D61 \u806F\u7E6B|\u80AF\u4E9E \u80AF\u5C3C\u4E9E|\u80F0\u81DF \u80F0\u817A|\u80F1\u80FA\u9178 \u80F1\u6C28\u9178|\u80FA\u57FA\u9178 \u6C28\u57FA\u9178|\u812F\u80FA\u9178 \u812F\u6C28\u9178|\u814E\u75C5\u75C7\u5019\u7FA4 \u814E\u75C5\u7D9C\u5408\u5FB5|\u8155\u96A7\u9053\u75C7\u5019\u7FA4 \u8155\u7BA1\u7D9C\u5408\u5FB5|\u8166\u6897\u585E \u8166\u6897\u6B7B|\u8173\u8E0F\u8ECA \u81EA\u884C\u8ECA|\u81EA\u52D5\u65CB\u8F49\u87A2\u5E55 \u81EA\u52D5\u8F49\u5C4F|\u81EA\u9589\u75C7 \u5B64\u7368\u75C7|\u8208\u5FB7\u5BC6\u7279 \u6B23\u5FB7\u7C73\u7279|\u8272\u80FA\u9178 \u8272\u6C28\u9178|\u827E\u514B\u68EE\u7F8E\u5B5A \u57C3\u514B\u68EE\u7F8E\u5B5A|\u827E\u723E\u52A0 \u57C3\u723E\u52A0|\u82EF\u4E19\u80FA\u9178 \u82EF\u4E19\u6C28\u9178|\u8305\u5229\u5854\u5C3C\u4E9E \u6BDB\u91CC\u5854\u5C3C\u4E9E|\u8340\u767D\u514B \u52F3\u4F2F\u683C|\u83AB\u4E09\u6BD4\u514B \u83AB\u6851\u6BD4\u514B|\u83AB\u672D\u7279 \u83AB\u624E\u7279|\u83DC\u55AE \u83DC\u55AE|\u83EF\u683C\u7D0D \u74E6\u683C\u7D0D|\u83EF\u723E\u9813 \u6C83\u723E\u9813|\u840A\u8A31 \u8CF4\u5E0C|\u840A\u96C5 \u6B50\u840A\u96C5|\u840A\u96C5\u96C6\u5718 \u6B50\u840A\u96C5\u96C6\u5718|\u842C\u7528\u5B57\u5143 \u901A\u914D\u7B26|\u842C\u90A3\u675C \u74E6\u52AA\u963F\u5716|\u8449\u9580 \u4E5F\u9580|\u845B\u4EE4\u5361 \u683C\u6797\u5361|\u845B\u5229\u683C \u683C\u91CC\u683C|\u845B\u62C9\u65AF \u683C\u62C9\u65AF|\u845B\u6469 \u79D1\u6469\u7F85|\u84B2\u9686\u5730 \u5E03\u9686\u8FEA|\u84CB\u4E9E\u90A3 \u572D\u4E9E\u90A3|\u84CB\u5E0C\u6587 \u683C\u4EC0\u6EAB|\u856D\u58EB\u5854\u9AD8\u7DAD\u5951 \u8096\u65AF\u5854\u79D1\u7DAD\u5947|\u856D\u90A6 \u8096\u90A6|\u85A9\u62C9\u6C99\u6CF0 \u85A9\u62C9\u85A9\u8482|\u85A9\u63D0 \u85A9\u8482|\u85CD\u8272\u756B\u9762 \u85CD\u5C4F|\u8607\u5229\u5357 \u8607\u91CC\u5357|\u8607\u80FA\u9178 \u8607\u6C28\u9178|\u8655\u7406\u7A0B\u5E8F \u8655\u7406\u7A0B\u5E8F|\u865B\u64EC\u51FD\u5F0F \u865B\u51FD\u6578|\u865B\u64EC\u6A5F\u5668 \u865B\u64EC\u6A5F|\u865B\u64EC\u78BC \u50DE\u4EE3\u78BC|\u87A2\u5E55 \u5C4F\u5E55|\u8840\u7D05\u7D20 \u8840\u7D05\u86CB\u767D|\u884C\u5167\u51FD\u6578 \u5167\u806F\u51FD\u6578|\u884C\u52D5\u5F0F \u4FBF\u651C\u5F0F|\u884C\u52D5\u6578\u64DA \u79FB\u52D5\u6578\u64DA|\u884C\u52D5\u786C\u789F \u79FB\u52D5\u786C\u76E4|\u884C\u52D5\u7DB2\u8DEF \u79FB\u52D5\u7DB2\u7D61|\u884C\u52D5\u901A\u8A0A \u79FB\u52D5\u901A\u4FE1|\u884C\u52D5\u96FB\u8A71 \u79FB\u52D5\u96FB\u8A71|\u884C\u7A0B \u9032\u7A0B|\u8863\u7D22\u6BD4\u4E9E \u57C3\u585E\u4FC4\u6BD4\u4E9E|\u8868\u793A\u5F0F \u8868\u9054\u5F0F|\u88DD\u7F6E \u8A2D\u5099|\u8907\u88FD \u62F7\u8C9D|\u897F\u5143 \u516C\u5143|\u897F\u7DAD\u5409\u5C3C\u4E9E \u897F\u5F17\u5409\u5C3C\u4E9E|\u897F\u7DAD\u5409\u5C3C\u4E9E\u5DDE \u897F\u5F17\u5409\u5C3C\u4E9E\u5DDE|\u897F\u8C9D\u6D41\u58EB \u897F\u8C9D\u67F3\u65AF|\u8996\u7A97 \u7A97\u53E3|\u8996\u89BA\u5316 \u53EF\u8996\u5316|\u8996\u8A0A \u8996\u983B|\u8996\u8A0A\u6703\u8B70 \u8996\u983B\u6703\u8B70|\u8996\u8A0A\u8A18\u61B6\u9AD4 \u986F\u5B58|\u8996\u8A0A\u901A\u8A71 \u8996\u983B\u901A\u8A71|\u89E3\u6790\u5EA6 \u5206\u8FA8\u7387|\u89E3\u69CB\u51FD\u5F0F \u6790\u69CB\u51FD\u6578|\u89E3\u69CB\u5B50 \u6790\u69CB\u51FD\u6578|\u89E3\u9664\u5B89\u88DD \u5378\u8F09|\u89F8\u63A7 \u89F8\u6478|\u89F8\u63A7\u5F0F\u87A2\u5E55 \u89F8\u6478\u5C4F|\u8A08\u7A0B\u8ECA \u51FA\u79DF\u8ECA|\u8A0A\u606F \u6D88\u606F|\u8A0A\u865F \u4FE1\u865F|\u8A0A\u96DC\u6BD4 \u4FE1\u566A\u6BD4|\u8A18\u61B6\u9AD4 \u5167\u5B58|\u8A2A\u554F \u8A2A\u554F|\u8A2D\u5B9A \u8A2D\u7F6E|\u8A31\u53EF\u6B0A \u6B0A\u9650|\u8A34\u8A1F\u7A0B\u5E8F \u8A34\u8A1F\u7A0B\u5E8F|\u8ABF\u8272\u76E4 \u8ABF\u8272\u76E4|\u8ABF\u8B8A \u8ABF\u88FD|\u8AFE\u9B6F \u7459\u9B6F|\u8B58\u5225\u7B26\u865F \u6A19\u8B58\u7B26|\u8B8A\u6578 \u8B8A\u91CF|\u8C61\u7259\u6D77\u5CB8 \u79D1\u7279\u8FEA\u74E6|\u8C9D\u5357 \u8C9D\u5BE7|\u8C9D\u91CC\u5C3C \u8C9D\u5229\u5C3C|\u8C9D\u91CC\u65AF \u4F2F\u5229\u8332|\u8CBC\u4E0A \u7C98\u8CBC|\u8CC7\u6599 \u6578\u64DA|\u8CC7\u6599\u4F86\u6E90 \u6578\u64DA\u6E90|\u8CC7\u6599\u5009\u5132 \u6578\u64DA\u5009\u5EAB|\u8CC7\u6599\u5305 \u6578\u64DA\u5831|\u8CC7\u6599\u593E \u6587\u4EF6\u593E|\u8CC7\u6599\u5EAB \u6578\u64DA\u5EAB|\u8CC7\u6599\u63A2\u52D8 \u6578\u64DA\u6316\u6398|\u8CC7\u8A0A \u4FE1\u606F|\u8CC7\u8A0A\u5B89\u5168 \u4FE1\u606F\u5B89\u5168|\u8CC7\u8A0A\u7406\u8AD6 \u4FE1\u606F\u8AD6|\u8CC7\u8A0A\u79D1\u6280 \u4FE1\u606F\u6280\u8853|\u8CC7\u8A0A\u9577 \u9996\u5E2D\u4FE1\u606F\u5B98|\u8CD3\u58EB \u5954\u99B3|\u8CF4\u6BD4\u745E\u4E9E \u5229\u6BD4\u91CC\u4E9E|\u8CF4\u7D22\u6258 \u840A\u7D22\u6258|\u8D85\u7A0B\u5F0F\u8A2D\u8A08 \u5143\u7DE8\u7A0B|\u8D85\u97F3\u6CE2 \u8D85\u8072\u6CE2|\u8DF3\u812B\u5B57\u5143 \u8F49\u7FA9\u5B57\u7B26|\u8EDF\u789F\u6A5F \u8EDF\u9A45|\u8EDF\u9AD4 \u8EDF\u4EF6|\u8EDF\u9AD4\u52D5\u7269 \u8EDF\u9AD4\u52D5\u7269|\u8F09\u5165 \u52A0\u8F09|\u8F09\u5165\u7A0B\u5F0F \u5F15\u5C0E\u7A0B\u5E8F|\u8F1D\u9054 \u82F1\u5049\u9054|\u8F9B\u5DF4\u5A01 \u6D25\u5DF4\u5E03\u97CB|\u8FE6\u7D0D \u52A0\u7D0D|\u8FF4\u5708 \u5FAA\u74B0|\u901A\u8A0A \u901A\u4FE1|\u901A\u8A71\u5361 \u901A\u8A0A\u5361|\u901A\u8A71\u8A18\u9304 \u806F\u7E6B\u6B77\u53F2|\u901A\u9053 \u901A\u9053|\u901F\u98DF\u9EB5 \u65B9\u4FBF\u9EAA|\u9023\u7D50 \u93C8\u63A5|\u9023\u7D50\u4E32\u5217 \u93C8\u8868|\u9023\u7DDA \u9023\u63A5|\u9032\u4F4D\u5236 \u9032\u5236|\u9032\u7A0B \u9032\u7A0B|\u9032\u968E \u9AD8\u7D1A|\u9032\u968E\u8A2D\u5B9A \u9AD8\u7D1A\u8A2D\u7F6E|\u9032\u968E\u9078\u9805 \u9AD8\u7D1A\u9078\u9805|\u904B\u7B97\u5143 \u64CD\u4F5C\u6578|\u904B\u7B97\u5B50 \u64CD\u4F5C\u7B26|\u904B\u7B97\u5F0F \u8868\u9054\u5F0F|\u904E\u52D5\u75C7 \u591A\u52D5\u75C7|\u904E\u8F09 \u91CD\u8F09|\u905E\u8FF4 \u905E\u6B78|\u9060\u7AEF \u9060\u7A0B|\u906E\u853D \u5C4F\u853D|\u9078\u55AE \u83DC\u55AE|\u908F\u8F2F\u9598 \u908F\u8F2F\u9580|\u90A3\u675C \u6EAB\u7D0D\u5716\u842C|\u90E8\u843D\u683C \u535A\u5BA2|\u90FD\u6703\u7DB2\u8DEF \u57CE\u57DF\u7DB2|\u916A\u80FA\u9178 \u916A\u6C28\u9178|\u91AF \u9170|\u91CB\u51FA \u767C\u4F48|\u91CD\u65B0\u547D\u540D \u91CD\u547D\u540D|\u91CD\u65B0\u6574\u7406 \u5237\u65B0|\u91CD\u704C \u91CD\u88DD|\u91D1\u6C27\u534A\u5C0E\u9AD4 \u91D1\u5C6C\u6C27\u5316\u7269\u534A\u5C0E\u9AD4|\u91D1\u9470 \u5BC6\u9470|\u923D \u9208|\u9272 \u9426|\u9273 \u9307|\u92C2 \u9387|\u9304\u5F71 \u9304\u50CF|\u933C \u93BF|\u9345 \u9201|\u939D \u9340|\u93A6 \u9465|\u9440 \u9384|\u958B\u555F \u6253\u958B|\u9598\u6D41\u9AD4 \u6676\u9598\u7BA1|\u9598\u9053\u5668 \u7DB2\u95DC|\u9598\u96FB\u8DEF \u9580\u96FB\u8DEF|\u95DC\u806F\u5F0F\u8CC7\u6599\u5EAB \u95DC\u4FC2\u6578\u64DA\u5EAB|\u9632\u5BEB \u5BEB\u4FDD\u8B77|\u9632\u6BD2 \u6BBA\u6BD2|\u963B\u65B7\u5291 \u963B\u6EEF\u5291|\u963F\u62C9\u4F2F\u806F\u5408\u5927\u516C\u570B \u963F\u62C9\u4F2F\u806F\u5408\u914B\u9577\u570B|\u963F\u65AF\u5339\u9748 \u963F\u53F8\u5339\u6797|\u963F\u65AF\u7279\u6377\u5229\u5EB7 \u963F\u65AF\u5229\u5EB7|\u963F\u65AF\u7279\u6377\u5229\u5EB7\u516C\u53F8 \u963F\u65AF\u5229\u5EB7\u516C\u53F8|\u963F\u8332\u6D77\u9ED8\u6C0F\u75C7 \u963F\u723E\u8328\u6D77\u9ED8\u6C0F\u75C7|\u963F\u8332\u6D77\u9ED8\u75C7 \u963F\u723E\u8328\u6D77\u9ED8\u75C7|\u963F\u83AB\u897F\u6797 \u963F\u83AB\u897F\u6797|\u9663\u5217 \u6578\u7D44|\u9664\u932F \u8ABF\u8A66|\u96A8\u8EAB\u789F U\u76E4|\u96DC\u6E4A \u54C8\u5E0C|\u96E2\u7DDA \u812B\u6A5F|\u96E2\u80FA\u9178 \u8CF4\u6C28\u9178|\u96F2\u7AEF\u5132\u5B58 \u96F2\u5B58\u5132|\u96F2\u7AEF\u8A08\u7B97 \u96F2\u8A08\u7B97|\u96F7\u5C04 \u6FC0\u5149|\u96F7\u8AFE\u6C0F\u75C7\u5019\u7FA4 \u96F7\u8AFE\u7D9C\u5408\u5FB5|\u96FB\u6676\u9AD4 \u6676\u9AD4\u7BA1|\u96FB\u8166\u4FDD\u5B89 \u8A08\u7B97\u6A5F\u5B89\u5168|\u96FB\u8166\u65B7\u5C64 \u8A08\u7B97\u6A5F\u65B7\u5C64|\u96FB\u8166\u79D1\u5B78 \u8A08\u7B97\u6A5F\u79D1\u5B78|\u970D\u6D1B\u7DAD\u8332 \u970D\u6D1B\u7DAD\u8328|\u975E\u540C\u6B65 \u7570\u6B65|\u97CB\u672C \u97CB\u4F2F\u6069|\u97CB\u74E6\u7B2C \u7DAD\u74E6\u723E\u7B2C|\u97CC\u9AD4 \u56FA\u4EF6|\u97D3\u5FB7\u723E \u4EA8\u5FB7\u723E|\u97F3\u6548\u5361 \u8072\u5361|\u97F3\u8A0A \u97F3\u983B|\u9801\u5C3E \u9801\u8173|\u9801\u9996 \u9801\u7709|\u9810\u8A2D \u9810\u8A2D|\u9810\u8A2D\u503C \u9ED8\u8A8D\u503C|\u983B\u5BEC \u5E36\u5BEC|\u985E\u522B\u7BC4\u672C \u985E\u6A21\u677F|\u985E\u6BD4 \u6A21\u64EC|\u985E\u6BD4\u96FB\u5B50 \u6A21\u64EC\u96FB\u5B50|\u985E\u6BD4\u96FB\u8DEF \u6A21\u64EC\u96FB\u8DEF|\u9867\u723E\u5FB7 \u53E4\u723E\u5FB7|\u986F\u793A\u5361 \u986F\u5361|\u98DB\u822A\u6A21\u5F0F \u98DB\u884C\u6A21\u5F0F|\u99AC\u51E1\u6C0F\u75C7 \u99AC\u65B9\u7D9C\u5408\u5FB5|\u99AC\u51E1\u6C0F\u75C7\u5019\u7FA4 \u99AC\u65B9\u7D9C\u5408\u5FB5|\u99AC\u5229\u5171\u548C\u570B \u99AC\u91CC\u5171\u548C\u570B|\u99AC\u723E\u5730\u592B \u99AC\u723E\u4EE3\u592B|\u99ED\u5BA2 \u9ED1\u5BA2|\u9AD8\u6548\u80FD\u904B\u7B97 \u9AD8\u6027\u80FD\u8A08\u7B97|\u9AD8\u756B\u8CEA \u9AD8\u6E05|\u9AD8\u7A7A\u5F48\u8DF3 \u8E66\u6975|\u9AD8\u7D1A \u9AD8\u7D1A|\u9AD8\u968E \u9AD8\u7D1A|\u9EA9\u80FA\u9178 \u7A40\u6C28\u9178|\u9EA9\u91AF\u80FA\u9178 \u7A40\u6C28\u9170\u80FA|\u9EBB\u85A9\u8AF8\u585E \u99AC\u85A9\u8AF8\u585E|\u9EBB\u85A9\u8AF8\u585E\u5DDE \u99AC\u85A9\u8AF8\u585E\u5DDE|\u9EC3\u9AD4\u7D20 \u5B55\u916E|\u9EDE\u9078 \u9EDE\u64CA|\u9EDE\u9663\u5716 \u4F4D\u5716";
var y = "\u4E00\u574F \u4E00\u576F|\u4E00\u76EE\u77AD\u7136 \u4E00\u76EE\u4E86\u7136|\u4E03\u9015 \u4E03\u8FF3|\u4E0A\u9015 \u4E0A\u8FF3|\u4E0A\u934A \u4E0A\u94FE|\u4E0D\u53EF\u8CB2\u8A08 \u4E0D\u53EF\u8D40\u8A08|\u4E0D\u77AD\u89E3 \u4E0D\u4E86\u89E3|\u4E48\u9EBC \u5E7A\u9EBD|\u4E48\u9EBD \u5E7A\u9EBD|\u4E5D\u9015\u5C71 \u4E5D\u8FF3\u5C71|\u4E7E\u4E7E\u6DE8\u6DE8 \u5E72\u5E72\u51C0\u51C0|\u4E7E\u4E7E\u8106\u8106 \u5E72\u5E72\u8106\u8106|\u4E7E\u4F51\u7E23 \u4E7E\u4F51\u53BF|\u4E7E\u5143 \u4E7E\u5143|\u4E7E\u5366 \u4E7E\u5366|\u4E7E\u5609 \u4E7E\u5609|\u4E7E\u5716 \u4E7E\u56FE|\u4E7E\u5764 \u4E7E\u5764|\u4E7E\u5764\u4E00\u64F2 \u4E7E\u5764\u4E00\u63B7|\u4E7E\u5764\u518D\u9020 \u4E7E\u5764\u518D\u9020|\u4E7E\u5764\u5927\u632A\u79FB \u4E7E\u5764\u5927\u632A\u79FB|\u4E7E\u5B85 \u4E7E\u5B85|\u4E7E\u5B89\u7E23 \u4E7E\u5B89\u53BF|\u4E7E\u5B89\u93AE \u4E7E\u5B89\u9547|\u4E7E\u5DDE \u4E7E\u5DDE|\u4E7E\u65B7 \u4E7E\u65AD|\u4E7E\u65E6 \u4E7E\u65E6|\u4E7E\u66DC \u4E7E\u66DC|\u4E7E\u6E05\u5BAE \u4E7E\u6E05\u5BAB|\u4E7E\u76DB\u4E16 \u4E7E\u76DB\u4E16|\u4E7E\u7D05 \u4E7E\u7EA2|\u4E7E\u7DB1 \u4E7E\u7EB2|\u4E7E\u7E23 \u4E7E\u53BF|\u4E7E\u8C61 \u4E7E\u8C61|\u4E7E\u9020 \u4E7E\u9020|\u4E7E\u9053 \u4E7E\u9053|\u4E7E\u95E5\u5A46 \u4E7E\u95FC\u5A46|\u4E7E\u9675 \u4E7E\u9675|\u4E7E\u9686 \u4E7E\u9686|\u4E7E\u9686\u5E74\u9593 \u4E7E\u9686\u5E74\u95F4|\u4E7E\u9686\u7687\u5E1D \u4E7E\u9686\u7687\u5E1D|\u4E8C\u5641\u82F1 \u4E8C\u{2BAC7}\u82F1|\u4EC7\u8B8E \u4EC7\u96E0|\u4EE5\u514D\u85C9\u53E3 \u4EE5\u514D\u501F\u53E3|\u4EE5\u529F\u8986\u904E \u4EE5\u529F\u8986\u8FC7|\u4EFB\u7B46\u6C88\u8A69 \u4EFB\u7B14\u6C88\u8BD7|\u4F94\u5FB7\u8986\u8F09 \u4F94\u5FB7\u8986\u8F7D|\u50A2\u4FF1 \u5BB6\u5177|\u50B7\u4EA1\u6795\u85C9 \u4F24\u4EA1\u6795\u85C9|\u5141\u7955 \u5141\u7955|\u516B\u6FDB\u5C71 \u516B\u6FDB\u5C71|\u5176\u9670\u591A\u8490 \u5176\u9634\u591A\u8490|\u51CC\u85C9 \u51CC\u501F|\u51FA\u919C\u72FC\u85C9 \u51FA\u4E11\u72FC\u85C9|\u51FD\u8986 \u51FD\u590D|\u524B\u67B6 \u524B\u67B6|\u524B\u6BD2 \u524B\u6BD2|\u5343\u937E\u7C9F \u5343\u953A\u7C9F|\u5357\u6C3E \u5357\u6C3E|\u5357\u9015 \u5357\u8FF3|\u53CD\u53CD\u8986\u8986 \u53CD\u53CD\u590D\u590D|\u53CD\u8986 \u53CD\u590D|\u53CD\u8986\u601D\u7DAD \u53CD\u590D\u601D\u7EF4|\u53CD\u8986\u601D\u91CF \u53CD\u590D\u601D\u91CF|\u53CD\u8986\u6027 \u53CD\u590D\u6027|\u540D\u8986\u91D1\u750C \u540D\u590D\u91D1\u74EF|\u5433\u7955 \u5434\u7955|\u5433\u80B2\u6607 \u5434\u80B2\u6607|\u54EA\u5412 \u54EA\u5412|\u56DE\u8986 \u56DE\u590D|\u571F\u574F \u571F\u576F|\u574F\u571F \u576F\u571F|\u574F\u5B50 \u576F\u5B50|\u574F\u5E03 \u576F\u5E03|\u574F\u6236 \u576F\u6237|\u58A8\u6C88\u6C88 \u58A8\u6C89\u6C89|\u58FA\u88CF\u4E7E\u5764 \u58F6\u91CC\u4E7E\u5764|\u5927\u76EE\u4E7E\u9023\u51A5\u9593\u6551\u6BCD\u8B8A\u6587 \u5927\u76EE\u4E7E\u8FDE\u51A5\u95F4\u6551\u6BCD\u53D8\u6587|\u5BAB\u5546\u89D2\u5FB5\u7FBD \u5BAB\u5546\u89D2\u5FB5\u7FBD|\u5C04\u8986 \u5C04\u8986|\u5C3C\u4E7E\u5B50 \u5C3C\u4E7E\u5B50|\u5C3C\u4E7E\u9640 \u5C3C\u4E7E\u9640|\u5E74\u91D0 \u5E74\u91D0|\u5E7A\u9EBC \u5E7A\u9EBD|\u5E7A\u9EBC\u5C0F\u4E11 \u5E7A\u9EBD\u5C0F\u4E11|\u5E7A\u9EBC\u5C0F\u919C \u5E7A\u9EBD\u5C0F\u4E11|\u5EB7\u4E7E \u5EB7\u4E7E|\u5F35\u6607 \u5F20\u6607|\u5F35\u6CD5\u4E7E \u5F20\u6CD5\u4E7E|\u5F77\u5F7F \u4EFF\u4F5B|\u5F77\u5FA8 \u5F77\u5FA8|\u5F90\u80E4\u6607 \u5F90\u80E4\u6607|\u5FA9\u7526 \u590D\u82CF|\u5FB5\u5F26 \u5FB5\u5F26|\u5FB5\u7D43 \u5FB5\u5F26|\u5FB5\u7FBD\u6469\u67EF \u5FB5\u7FBD\u6469\u67EF|\u5FB5\u8072 \u5FB5\u58F0|\u5FB5\u8ABF \u5FB5\u8C03|\u5FB5\u97F3 \u5FB5\u97F3|\u60C5\u6709\u7368\u937E \u60C5\u6709\u72EC\u949F|\u60F3\u50CF \u60F3\u50CF|\u610F\u5FD7\u6D88\u6C88 \u610F\u5FD7\u6D88\u6C89|\u6170\u85C9 \u6170\u85C9|\u6170\u85C9\u7740 \u6170\u85C9\u7740|\u6191\u85C9 \u51ED\u501F|\u6191\u85C9\u7740 \u51ED\u501F\u7740|\u61F7\u91D0 \u6000\u91D0|\u6210\u7526 \u6210\u7526|\u6240\u8CBB\u4E0D\u8CB2 \u6240\u8D39\u4E0D\u8D40|\u624B\u934A \u624B\u94FE|\u6253\u574F \u6253\u576F|\u625E\u683C \u625E\u683C|\u626D\u8F49\u4E7E\u5764 \u626D\u8F6C\u4E7E\u5764|\u6279\u8986 \u6279\u590D|\u627E\u85C9\u53E3 \u627E\u501F\u53E3|\u6298\u621F\u6C88\u6C99 \u6298\u621F\u6C89\u6C99|\u6298\u621F\u6C88\u6CB3 \u6298\u621F\u6C89\u6CB3|\u62C9\u574F \u62C9\u576F|\u62C9\u934A \u62C9\u94FE|\u62C9\u934A\u5DE5\u7A0B \u62C9\u94FE\u5DE5\u7A0B|\u62DC\u8986 \u62DC\u590D|\u6328\u524B \u6328\u524B|\u634F\u574F \u634F\u576F|\u64CA\u6C88 \u51FB\u6C89|\u64DA\u77AD\u89E3 \u636E\u4E86\u89E3|\u6587\u9326\u8986\u9631 \u6587\u9526\u8986\u9631|\u65BC\u4E16\u6210 \u65BC\u4E16\u6210|\u65BC\u4E4E \u65BC\u4E4E|\u65BC\u4EF2\u5B8C \u65BC\u4EF2\u5B8C|\u65BC\u502B \u65BC\u4F26|\u65BC\u5176\u4E00 \u65BC\u5176\u4E00|\u65BC\u5247 \u65BC\u5219|\u65BC\u52C7\u660E \u65BC\u52C7\u660E|\u65BC\u547C\u54C0\u54C9 \u65BC\u547C\u54C0\u54C9|\u65BC\u55AE \u65BC\u5355|\u65BC\u5766 \u65BC\u5766|\u65BC\u5D07\u6587 \u65BC\u5D07\u6587|\u65BC\u5FE0\u7965 \u65BC\u5FE0\u7965|\u65BC\u60DF\u4E00 \u65BC\u60DF\u4E00|\u65BC\u6232 \u65BC\u620F|\u65BC\u6556 \u65BC\u6556|\u65BC\u68A8\u83EF \u65BC\u68A8\u534E|\u65BC\u6E05\u8A00 \u65BC\u6E05\u8A00|\u65BC\u6F5B \u65BC\u6F5C|\u65BC\u7433 \u65BC\u7433|\u65BC\u7A46 \u65BC\u7A46|\u65BC\u7AF9\u5C4B \u65BC\u7AF9\u5C4B|\u65BC\u83DF \u65BC\u83DF|\u65BC\u9091 \u65BC\u9091|\u65BC\u9675\u5B50 \u65BC\u9675\u5B50|\u65CB\u4E7E\u8F49\u5764 \u65CB\u4E7E\u8F6C\u5764|\u65CB\u8F49\u4E7E\u5764 \u65CB\u8F6C\u4E7E\u5764|\u65CB\u8F49\u4E7E\u5764\u4E4B\u529B \u65CB\u8F6C\u4E7E\u5764\u4E4B\u529B|\u660E\u77AD \u660E\u4E86|\u660E\u8986 \u660E\u590D|\u660F\u6C88 \u660F\u6C89|\u6625\u8490 \u6625\u8490|\u6625\u91D0 \u6625\u91D0|\u6697\u6C88\u6C88 \u6697\u6C89\u6C89|\u66F8\u4E2D\u81EA\u6709\u5343\u937E\u7C9F \u4E66\u4E2D\u81EA\u6709\u5343\u953A\u7C9F|\u6709\u5E8F \u6709\u5E8F|\u671D\u4E7E\u5915\u60D5 \u671D\u4E7E\u5915\u60D5|\u6728\u5412 \u6728\u5412|\u674E\u4E7E\u5FB7 \u674E\u4E7E\u5FB7|\u674E\u6607 \u674E\u6607|\u674E\u6607\u52F3 \u674E\u6607\u52CB|\u674E\u6FA4\u9245 \u674E\u6CFD\u949C|\u674E\u7955 \u674E\u7955|\u674E\u934A\u798F \u674E\u94FE\u798F|\u674E\u937E\u90C1 \u674E\u953A\u90C1|\u675F\u8129 \u675F\u8129|\u6771\u6C3E \u4E1C\u6C3E|\u6797\u7526 \u6797\u7526|\u6821\u8B8E \u6821\u96E0|\u6881\u6607\u537F \u6881\u6607\u537F|\u6881\u7AE0\u9245 \u6881\u7AE0\u949C|\u694A\u7526\u68E3 \u6768\u7526\u68E3|\u694A\u806F\u965E \u6768\u8054\u965E|\u6A0A\u65BC\u671F \u6A0A\u65BC\u671F|\u6A61\u6900 \u6A61\u6900|\u6B7B\u6C23\u6C88\u6C88 \u6B7B\u6C14\u6C89\u6C89|\u6BB5\u8129 \u6BB5\u8129|\u6BDB\u574F \u6BDB\u576F|\u6C34\u9015 \u6C34\u8FF3|\u6C3E\u52DD\u4E4B \u6C3E\u80DC\u4E4B|\u6C3E\u5357 \u6C3E\u5357|\u6C3E\u570B \u6C3E\u56FD|\u6C3E\u6C34 \u6C3E\u6C34|\u6C88\u4E0B \u6C89\u4E0B|\u6C88\u4E0D\u4F4F\u6C23 \u6C89\u4E0D\u4F4F\u6C14|\u6C88\u4F4F\u6C23 \u6C89\u4F4F\u6C14|\u6C88\u51A4 \u6C89\u51A4|\u6C88\u539A \u6C89\u539A|\u6C88\u541F \u6C89\u541F|\u6C88\u5BC2 \u6C89\u5BC2|\u6C88\u5F97\u4F4F\u6C23 \u6C89\u5F97\u4F4F\u6C14|\u6C88\u601D \u6C89\u601D|\u6C88\u601D\u5F80\u4E8B \u6C89\u601D\u5F80\u4E8B|\u6C88\u60B6 \u6C89\u95F7|\u6C88\u6C92 \u6C89\u6CA1|\u6C88\u6C92\u6210\u672C \u6C89\u6CA1\u6210\u672C|\u6C88\u6D6E \u6C89\u6D6E|\u6C88\u6D78 \u6C89\u6D78|\u6C88\u6D78\u65BC \u6C89\u6D78\u4E8E|\u6C88\u6DEA \u6C89\u6CA6|\u6C88\u6E4E \u6C89\u6E4E|\u6C88\u6E4E\u9152\u8272 \u6C89\u6E4E\u9152\u8272|\u6C88\u6EBA \u6C89\u6EBA|\u6C88\u6EEF \u6C89\u6EDE|\u6C88\u6EEF\u6027 \u6C89\u6EDE\u6027|\u6C88\u6FB1 \u6C89\u6DC0|\u6C88\u6FB1\u51FA\u4F86 \u6C89\u6DC0\u51FA\u6765|\u6C88\u6FB1\u5291 \u6C89\u6DC0\u5242|\u6C88\u6FB1\u6CD5 \u6C89\u6DC0\u6CD5|\u6C88\u6FB1\u7269 \u6C89\u6DC0\u7269|\u6C88\u6FC1 \u6C89\u6D4A|\u6C88\u7538\u7538 \u6C89\u7538\u7538|\u6C88\u75DB \u6C89\u75DB|\u6C88\u75FC \u6C89\u75FC|\u6C88\u75FE \u6C89\u75B4|\u6C88\u7761 \u6C89\u7761|\u6C88\u7761\u4E0D\u9192 \u6C89\u7761\u4E0D\u9192|\u6C88\u7802\u6C60 \u6C89\u7802\u6C60|\u6C88\u7A4D \u6C89\u79EF|\u6C88\u7A4D\u5CA9 \u6C89\u79EF\u5CA9|\u6C88\u7A4D\u77F3 \u6C89\u79EF\u77F3|\u6C88\u7B52 \u6C89\u7B52|\u6C88\u8239 \u6C89\u8239|\u6C88\u843D \u6C89\u843D|\u6C88\u8A69\u4EFB\u7B46 \u6C88\u8BD7\u4EFB\u7B14|\u6C88\u8FF7 \u6C89\u8FF7|\u6C88\u8FF7\u4E0D\u9192 \u6C89\u8FF7\u4E0D\u9192|\u6C88\u9189 \u6C89\u9189|\u6C88\u91CD \u6C89\u91CD|\u6C88\u964D \u6C89\u964D|\u6C88\u9677 \u6C89\u9677|\u6C88\u975C \u6C89\u9759|\u6C88\u975C\u4E0B\u4F86 \u6C89\u9759\u4E0B\u6765|\u6C88\u9999 \u6C89\u9999|\u6C88\u9B31 \u6C89\u90C1|\u6C88\u9B5A\u843D\u96C1 \u6C89\u9C7C\u843D\u96C1|\u6C88\u9ED8 \u6C89\u9ED8|\u6C88\u9ED8\u4E0D\u8A9E \u6C89\u9ED8\u4E0D\u8BED|\u6C88\u9ED8\u5BE1\u8A00 \u6C89\u9ED8\u5BE1\u8A00|\u6C99\u9015 \u6C99\u8FF3|\u6CB3\u9015 \u6CB3\u8FF3|\u6D41\u5FB5 \u6D41\u5FB5|\u6D6A\u8569\u4E7E\u5764 \u6D6A\u8361\u4E7E\u5764|\u6D6E\u6C88 \u6D6E\u6C89|\u6D77\u54E9 \u6D77\u91CC|\u6DF1\u6C88 \u6DF1\u6C89|\u6DF1\u6C88\u4E0D\u9732 \u6DF1\u6C89\u4E0D\u9732|\u6EAB\u6607\u8C6A \u6E29\u6607\u8C6A|\u6ED1\u85C9 \u6ED1\u501F|\u70CF\u6607 \u4E4C\u6607|\u70CF\u6C88\u6C88 \u4E4C\u6C89\u6C89|\u70CF\u9015 \u4E4C\u8FF3|\u7121\u5E8F \u65E0\u5E8F|\u72D0\u85C9\u864E\u5A01 \u72D0\u501F\u864E\u5A01|\u738B\u5F65\u6607 \u738B\u5F66\u6607|\u73CD\u73E0\u9805\u934A \u73CD\u73E0\u9879\u94FE|\u751A\u9245 \u751A\u949C|\u7526\u751F \u82CF\u751F|\u7526\u9192 \u82CF\u9192|\u7533\u6607\u52F3 \u7533\u6607\u52CB|\u7533\u8986 \u7533\u590D|\u7562\u6607 \u6BD5\u6607|\u767C\u8986 \u53D1\u8986|\u76E7\u8C61\u6607 \u5362\u8C61\u6607|\u76EE\u5284 \u76EE\u5284|\u77AD\u54E8 \u77AD\u54E8|\u77AD\u5982 \u4E86\u5982|\u77AD\u5982\u6307\u638C \u4E86\u5982\u6307\u638C|\u77AD\u671B \u77AD\u671B|\u77AD\u7136 \u4E86\u7136|\u77AD\u7136\u65BC\u5FC3 \u4E86\u7136\u4E8E\u5FC3|\u77AD\u82E5\u6307\u638C \u4E86\u82E5\u6307\u638C|\u77AD\u89E3 \u4E86\u89E3|\u77AD\u89E3\u5230 \u4E86\u89E3\u5230|\u7834\u91DC\u6C88\u821F \u7834\u91DC\u6C89\u821F|\u78DA\u574F \u7816\u576F|\u793A\u8986 \u793A\u590D|\u793E\u9015 \u793E\u8FF3|\u7955\u4E15\u7B08 \u7955\u4E15\u7B08|\u7955\u5F6D\u7956 \u7955\u5F6D\u7956|\u7955\u74CA \u7955\u743C|\u795D\u91D0 \u795D\u91D0|\u795E\u7947 \u795E\u7947|\u7A1F\u8986 \u7980\u590D|\u7AFA\u4E7E \u7AFA\u4E7E|\u7B54\u8986 \u7B54\u590D|\u7BE4\u9EBC \u7B03\u9EBD|\u7C21\u55AE\u660E\u77AD \u7B80\u5355\u660E\u4E86|\u7C4C\u756B \u7B79\u5212|\u7D20\u85C9 \u7D20\u501F|\u8001\u614B\u9F8D\u937E \u8001\u6001\u9F99\u949F|\u8033\u6C88 \u8033\u6C89|\u8089\u8129 \u8089\u8129|\u8098\u624B\u934A\u8DB3 \u8098\u624B\u94FE\u8DB3|\u80E4\u7955 \u80E4\u7955|\u8129\u656C \u8129\u656C|\u8129\u70B3 \u8129\u70B3|\u8129\u8121 \u8129\u8121|\u8129\u812F \u8129\u812F|\u8129\u91D1 \u8129\u91D1|\u812B\u574F \u8131\u576F|\u8176\u8129 \u8176\u8129|\u82F1\u54E9 \u82F1\u91CC|\u8305\u8490 \u8305\u8490|\u8335\u85C9 \u8335\u501F|\u842C\u937E \u4E07\u953A|\u843D\u96C1\u6C88\u9B5A \u843D\u96C1\u6C89\u9C7C|\u8490\u4E8E\u7D05 \u8490\u4E8E\u7EA2|\u8490\u65BC\u7D05 \u8490\u4E8E\u7EA2|\u8490\u72E9 \u8490\u72E9|\u8490\u736E \u8490\u72DD|\u8490\u7375 \u8490\u730E|\u8490\u7530 \u8490\u7530|\u8490\u754B \u8490\u754B|\u8490\u82D7 \u8490\u82D7|\u849C\u85B9 \u849C\u85B9|\u8523\u6607 \u848B\u6607|\u8553\u85B9 \u82B8\u85B9|\u8569\u8986 \u8361\u8986|\u856D\u4E7E \u8427\u4E7E|\u85C9\u4EE3 \u501F\u4EE3|\u85C9\u4EE5 \u501F\u4EE5|\u85C9\u52A9 \u501F\u52A9|\u85C9\u52A9\u65BC \u501F\u52A9\u4E8E|\u85C9\u5349 \u501F\u5349|\u85C9\u53E3 \u501F\u53E3|\u85C9\u55BB \u501F\u55BB|\u85C9\u5BC7\u5175 \u501F\u5BC7\u5175|\u85C9\u5BC7\u5175\u9F4E\u76DC\u7CE7 \u501F\u5BC7\u5175\u8D4D\u76D7\u7CAE|\u85C9\u624B \u501F\u624B|\u85C9\u64DA \u501F\u636E|\u85C9\u6545 \u501F\u6545|\u85C9\u6545\u63A8\u8FAD \u501F\u6545\u63A8\u8F9E|\u85C9\u65B9 \u501F\u65B9|\u85C9\u689D \u501F\u6761|\u85C9\u69C1 \u501F\u69C1|\u85C9\u6A5F \u501F\u673A|\u85C9\u6B64 \u501F\u6B64|\u85C9\u6B64\u6A5F\u6703 \u501F\u6B64\u673A\u4F1A|\u85C9\u751A \u501F\u751A|\u85C9\u7531 \u501F\u7531|\u85C9\u7740 \u501F\u7740|\u85C9\u7AEF \u501F\u7AEF|\u85C9\u7AEF\u751F\u4E8B \u501F\u7AEF\u751F\u4E8B|\u85C9\u7BB8\u4EE3\u7C4C \u501F\u7BB8\u4EE3\u7B79|\u85C9\u8349\u6795\u584A \u501F\u8349\u6795\u5757|\u85C9\u85C9 \u85C9\u85C9|\u85C9\u85C9\u65E0\u540D \u85C9\u85C9\u65E0\u540D|\u85C9\u8A5E \u501F\u8BCD|\u85C9\u8B80 \u501F\u8BFB|\u85C9\u8CC7 \u501F\u8D44|\u8879\u5F97 \u53EA\u5F97|\u8879\u898B\u6A39\u6728 \u53EA\u89C1\u6811\u6728|\u8879\u898B\u6A39\u6728\u4E0D\u898B\u68EE\u6797 \u53EA\u89C1\u6811\u6728\u4E0D\u89C1\u68EE\u6797|\u8881\u7955 \u8881\u7955|\u8896\u88CF\u4E7E\u5764 \u8896\u91CC\u4E7E\u5764|\u88B7\u88A2 \u88B7\u88A2|\u88FD\u574F \u5236\u576F|\u8986\u4E0A \u8986\u4E0A|\u8986\u4F4F \u8986\u4F4F|\u8986\u4FE1 \u590D\u4FE1|\u8986\u5192 \u8986\u5192|\u8986\u5448 \u590D\u5448|\u8986\u547D \u590D\u547D|\u8986\u5893 \u590D\u5893|\u8986\u5B97 \u8986\u5B97|\u8986\u5E33 \u590D\u5E10|\u8986\u5E6C \u8986\u5E31|\u8986\u6210 \u8986\u6210|\u8986\u6309 \u590D\u6309|\u8986\u6587 \u590D\u6587|\u8986\u676F \u8986\u676F|\u8986\u6821 \u590D\u6821|\u8986\u74FF \u8986\u74FF|\u8986\u76C2 \u8986\u76C2|\u8986\u76C6 \u8986\u76C6|\u8986\u76C6\u5B50 \u8986\u76C6\u5B50|\u8986\u76E4 \u8986\u76D8|\u8986\u80B2 \u8986\u80B2|\u8986\u8549\u5C0B\u9E7F \u8986\u8549\u5BFB\u9E7F|\u8986\u9006 \u8986\u9006|\u8986\u91A2 \u8986\u91A2|\u8986\u91AC\u74FF \u8986\u9171\u74FF|\u8986\u96FB \u590D\u7535|\u8986\u9732 \u8986\u9732|\u8986\u9E7F\u5C0B\u8549 \u8986\u9E7F\u5BFB\u8549|\u8986\u9E7F\u907A\u8549 \u8986\u9E7F\u9057\u8549|\u8986\u9F0E \u8986\u9F0E|\u898B\u8986 \u89C1\u590D|\u89D2\u5FB5 \u89D2\u5FB5|\u89D2\u5FB5\u7FBD \u89D2\u5FB5\u7FBD|\u8A08\u756B \u8BA1\u5212|\u8A31\u7526\u9B42 \u8BB8\u7526\u9B42|\u8B8A\u5FB5 \u53D8\u5FB5|\u8B8A\u5FB5\u4E4B\u8072 \u53D8\u5FB5\u4E4B\u58F0|\u8B8A\u5FB5\u4E4B\u97F3 \u53D8\u5FB5\u4E4B\u97F3|\u8B8E\u5B9A \u96E0\u5B9A|\u8C3F\u5DE5 \u8C3F\u5DE5|\u8C82\u8986\u984D \u8C82\u8986\u989D|\u8CB7\u81E3\u8986\u6C34 \u4E70\u81E3\u8986\u6C34|\u8D64\u77F3\u9015 \u8D64\u77F3\u8FF3|\u8E05\u9580\u77AD\u6236 \u8E05\u95E8\u4E86\u6237|\u8EAA\u85C9 \u8E8F\u501F|\u8F09\u6C88\u8F09\u6D6E \u8F7D\u6C89\u8F7D\u6D6E|\u8F09\u6D6E\u8F09\u6C88 \u8F7D\u6D6E\u8F7D\u6C89|\u8F9B\u7955 \u8F9B\u7955|\u9006\u91D0 \u9006\u91D0|\u9015\u53E3 \u8FF3\u53E3|\u9015\u806F \u8FF3\u8054|\u9015\u982D \u8FF3\u5934|\u90ED\u5B50\u4E7E \u90ED\u5B50\u4E7E|\u9152\u9022\u77E5\u5DF1\u5343\u937E\u5C11 \u9152\u9022\u77E5\u5DF1\u5343\u953A\u5C11|\u919E\u85C9 \u915D\u501F|\u91CD\u8986 \u91CD\u590D|\u91D1\u5412 \u91D1\u5412|\u91D1\u6607\u739F \u91D1\u6607\u739F|\u91D1\u934A \u91D1\u94FE|\u921E\u8986 \u94A7\u590D|\u9245\u5B50 \u949C\u5B50|\u9245\u842C \u949C\u4E07|\u9245\u9632 \u949C\u9632|\u9278\u934A \u94F0\u94FE|\u9280\u934A \u94F6\u94FE|\u92FC\u574F \u94A2\u576F|\u9322\u937E\u66F8 \u94B1\u953A\u4E66|\u934A\u589C \u94FE\u5760|\u934A\u5B50 \u94FE\u5B50|\u934A\u5F62 \u94FE\u5F62|\u934A\u689D \u94FE\u6761|\u934A\u9318 \u94FE\u9524|\u934A\u9396 \u94FE\u9501|\u935B\u937E \u953B\u953A|\u937E\u7E47 \u953A\u7E47|\u937E\u842C\u6885 \u953A\u4E07\u6885|\u937E\u91CD\u767C \u953A\u91CD\u53D1|\u937E\u935B \u953A\u953B|\u937E\u9997 \u953A\u9997|\u9396\u934A \u9501\u94FE|\u9435\u934A \u94C1\u94FE|\u947D\u77F3\u9805\u934A \u94BB\u77F3\u9879\u94FE|\u947F\u574F \u51FF\u576F|\u95BB\u9DB4\u6607 \u960E\u9E64\u6607|\u9670\u6C88 \u9634\u6C89|\u9670\u6C88\u6C88 \u9634\u6C89\u6C89|\u9670\u9670\u6C88\u6C88 \u9634\u9634\u6C89\u6C89|\u9673\u5FD7\u6607 \u9648\u5FD7\u6607|\u9673\u6607 \u9648\u6607|\u9673\u7526 \u9648\u7526|\u9676\u574F \u9676\u576F|\u96C1\u6773\u9B5A\u6C88 \u96C1\u6773\u9C7C\u6C89|\u96D6\u8986\u80FD\u5FA9 \u867D\u8986\u80FD\u590D|\u96FB\u8986 \u7535\u590D|\u9732\u8986 \u9732\u8986|\u97D3\u6607\u5EF6 \u97E9\u6607\u5EF6|\u97D3\u7526 \u97E9\u7526|\u9805\u934A \u9879\u94FE|\u9817\u8986 \u9887\u8986|\u9838\u934A \u9888\u94FE|\u985B\u4E7E\u5012\u5764 \u98A0\u4E7E\u5012\u5764|\u985B\u5012\u4E7E\u5764 \u98A0\u5012\u4E7E\u5764|\u9867\u85C9 \u987E\u501F|\u99AE\u7526 \u51AF\u7526|\u9B4F\u5FB5 \u9B4F\u5FB5|\u9B5A\u6C88\u96C1\u6773 \u9C7C\u6C89\u96C1\u6773|\u9EAA\u574F\u5152 \u9762\u576F\u513F|\u9EBC\u4E9B\u65CF \u9EBD\u4E9B\u65CF|\u9EC3\u7526 \u9EC4\u7526|\u9EC3\u937E\u516C \u9EC4\u953A\u516C|\u9ED1\u6C88\u6C88 \u9ED1\u6C89\u6C89|\u9F8D\u937E \u9F99\u949F|\u9F94\u6607 \u9F9A\u6607";
var m = "\u346F \u3454|\u3473 \u3447|\u3476 \u3439|\u34E8 \u523E|\u35F2 \u{20D7E}|\u361A \u360E|\u3704 \u36AF|\u370F \u36E3|\u3722 \u{217B1}|\u380F \u37C6|\u3823 \u{2BD77}|\u396E \u3918|\u3A5C \u3A2B|\u3A73 \u39D0|\u3A75 \u64DC|\u3E8F \u{2480B}|\u406A \u{251E2}|\u407B \u4025|\u40EE \u9FCE|\u42B7 \u4336|\u42D9 \u433A|\u42DA \u433B|\u42F9 \u433F|\u42FB \u433E|\u4366 \u4360|\u43B1 \u43AC|\u44E3 \u{2C72F}|\u4661 \u464C|\u4700 \u4727|\u477C \u478D|\u4875 \u{2B7E6}|\u4947 \u4982|\u4951 \u9FCF|\u4955 \u{2CB6F}|\u4971 \u497E|\u499B \u49B6|\u499F \u49B7|\u49E2 \u{28E1F}|\u4B84 \u{2B80A}|\u4BC0 \u4BC5|\u4C3E \u9C83|\u4C77 \u4CA3|\u4C7D \u4C9D|\u4C81 \u9CDA|\u4C98 \u9CE4|\u4D09 \u9E6E|\u4E1F \u4E22|\u4E26 \u5E76|\u4E7E \u5E72|\u4E82 \u4E71|\u4E99 \u4E98|\u4E9E \u4E9A|\u4F47 \u4F2B|\u4F48 \u5E03|\u4F54 \u5360|\u4F75 \u5E76|\u4F86 \u6765|\u4F96 \u4ED1|\u4FB6 \u4FA3|\u4FB7 \u5C40|\u4FC1 \u4FE3|\u4FC2 \u7CFB|\u4FD4 \u4F23|\u4FE0 \u4FA0|\u4FE5 \u4F21|\u4FEC \u79C1|\u5000 \u4F25|\u5006 \u4FE9|\u5008 \u4FEB|\u5009 \u4ED3|\u500B \u4E2A|\u5011 \u4EEC|\u5016 \u5E78|\u502B \u4F26|\u5032 \u3448|\u5049 \u4F1F|\u5051 \u343D|\u5074 \u4FA7|\u5075 \u4FA6|\u507D \u4F2A|\u508C \u3437|\u5091 \u6770|\u5096 \u4F27|\u5098 \u4F1E|\u5099 \u5907|\u50A2 \u5BB6|\u50AD \u4F63|\u50AF \u506C|\u50B3 \u4F20|\u50B4 \u4F1B|\u50B5 \u503A|\u50B7 \u4F24|\u50BE \u503E|\u50C2 \u507B|\u50C5 \u4EC5|\u50C9 \u4F65|\u50D1 \u4FA8|\u50D5 \u4EC6|\u50DE \u4F2A|\u50E4 \u{2B8B8}|\u50E5 \u4FA5|\u50E8 \u507E|\u50F1 \u96C7|\u50F9 \u4EF7|\u5100 \u4EEA|\u5101 \u4FCA|\u5102 \u4FAC|\u5104 \u4EBF|\u5108 \u4FA9|\u5109 \u4FED|\u510E \u50A4|\u5110 \u50A7|\u5114 \u4FE6|\u5115 \u4FAA|\u5118 \u5C3D|\u511F \u507F|\u512A \u4F18|\u5132 \u50A8|\u5137 \u4FEA|\u5138 \u3469|\u513A \u50A9|\u513B \u50A5|\u513C \u4FE8|\u5147 \u51F6|\u514C \u5151|\u5152 \u513F|\u5157 \u5156|\u5167 \u5185|\u5169 \u4E24|\u518A \u518C|\u5191 \u80C4|\u51AA \u5E42|\u51C8 \u51C0|\u51CD \u51BB|\u51DC \u51DB|\u51F1 \u51EF|\u5225 \u522B|\u522A \u5220|\u5244 \u522D|\u5247 \u5219|\u524B \u514B|\u524E \u5239|\u5257 \u522C|\u525B \u521A|\u525D \u5265|\u526E \u5250|\u5274 \u5240|\u5275 \u521B|\u5277 \u94F2|\u5283 \u5212|\u5284 \u672D|\u5287 \u5267|\u5289 \u5218|\u528A \u523D|\u528C \u523F|\u528D \u5251|\u528F \u34E5|\u5291 \u5242|\u529A \u3509|\u52C1 \u52B2|\u52D5 \u52A8|\u52D9 \u52A1|\u52DB \u52CB|\u52DD \u80DC|\u52DE \u52B3|\u52E2 \u52BF|\u52E3 \u{2A7DD}|\u52E9 \u52DA|\u52F1 \u52A2|\u52F3 \u52CB|\u52F5 \u52B1|\u52F8 \u529D|\u52FB \u5300|\u532D \u5326|\u532F \u6C47|\u5331 \u532E|\u5340 \u533A|\u5354 \u534F|\u5379 \u6064|\u537B \u5374|\u537D \u5373|\u5399 \u538D|\u53A0 \u5395|\u53A4 \u5386|\u53AD \u538C|\u53B2 \u5389|\u53B4 \u53A3|\u53C3 \u53C2|\u53C4 \u53C1|\u53E2 \u4E1B|\u5412 \u54A4|\u5433 \u5434|\u5436 \u5450|\u5442 \u5415|\u54BC \u5459|\u54E1 \u5458|\u5504 \u5457|\u5538 \u5FF5|\u554F \u95EE|\u5553 \u542F|\u555E \u54D1|\u555F \u542F|\u5562 \u5521|\u558E \u359E|\u559A \u5524|\u55AA \u4E27|\u55AB \u5403|\u55AC \u4E54|\u55AE \u5355|\u55B2 \u54DF|\u55C6 \u545B|\u55C7 \u556C|\u55CA \u551D|\u55CE \u5417|\u55DA \u545C|\u55E9 \u5522|\u55F0 \u{20BB6}|\u55F6 \u54D4|\u5606 \u53F9|\u560D \u55BD|\u5613 \u556F|\u5614 \u5455|\u5616 \u5567|\u5617 \u5C1D|\u561C \u551B|\u5629 \u54D7|\u562E \u5520|\u562F \u5578|\u5630 \u53FD|\u5635 \u54D3|\u5638 \u5452|\u563D \u5574|\u5641 \u6076|\u5653 \u5618|\u565A \u358A|\u565D \u549D|\u5660 \u54D2|\u5665 \u54DD|\u5666 \u54D5|\u566F \u55F3|\u5672 \u54D9|\u5674 \u55B7|\u5678 \u5428|\u5679 \u5F53|\u5680 \u549B|\u5687 \u5413|\u568C \u54DC|\u5690 \u5C1D|\u5695 \u565C|\u5699 \u556E|\u56A5 \u54BD|\u56A6 \u5456|\u56A7 \u{20C37}|\u56A8 \u5499|\u56AE \u5411|\u56B2 \u4EB8|\u56B3 \u55BE|\u56B4 \u4E25|\u56B6 \u5624|\u56C0 \u556D|\u56C1 \u55EB|\u56C2 \u56A3|\u56C5 \u5181|\u56C8 \u5453|\u56C9 \u5570|\u56CC \u82CF|\u56D1 \u5631|\u56EA \u56F1|\u5707 \u56F5|\u570B \u56FD|\u570D \u56F4|\u5712 \u56ED|\u5713 \u5706|\u5716 \u56FE|\u5718 \u56E2|\u57BB \u575D|\u57E1 \u57AD|\u57E8 \u{2BB62}|\u57F0 \u91C7|\u57F7 \u6267|\u5805 \u575A|\u580A \u57A9|\u5816 \u57B4|\u581D \u57DA|\u582F \u5C27|\u5831 \u62A5|\u5834 \u573A|\u584A \u5757|\u584B \u8314|\u584F \u57B2|\u5852 \u57D8|\u5857 \u6D82|\u585A \u51A2|\u5862 \u575E|\u5864 \u57D9|\u5875 \u5C18|\u5878 \u{2BB5F}|\u5879 \u5811|\u587F \u{2A8FB}|\u588A \u57AB|\u589C \u5760|\u58A0 \u{2BB83}|\u58AE \u5815|\u58B0 \u575B|\u58B3 \u575F|\u58B6 \u57AF|\u58BB \u5899|\u58BE \u57A6|\u58C7 \u575B|\u58CB \u57B1|\u58CE \u57D9|\u58D3 \u538B|\u58D7 \u{212E4}|\u58D8 \u5792|\u58D9 \u5739|\u58DA \u5786|\u58DC \u575B|\u58DE \u574F|\u58DF \u5784|\u58E0 \u5785|\u58E2 \u575C|\u58E9 \u575D|\u58EA \u5846|\u58EF \u58EE|\u58FA \u58F6|\u58FC \u58F8|\u58FD \u5BFF|\u5920 \u591F|\u5922 \u68A6|\u5925 \u4F19|\u593E \u5939|\u5950 \u5942|\u5967 \u5965|\u5969 \u5941|\u596A \u593A|\u596C \u5956|\u596E \u594B|\u597C \u59F9|\u599D \u5986|\u59CD \u59D7|\u59E6 \u5978|\u5A19 \u{2BC1B}|\u5A1B \u5A31|\u5A41 \u5A04|\u5A66 \u5987|\u5A6D \u5A05|\u5AA7 \u5A32|\u5AAF \u59AB|\u5AB0 \u36C0|\u5ABC \u5AAA|\u5ABD \u5988|\u5ACB \u8885|\u5AD7 \u59AA|\u5AF5 \u59A9|\u5AFA \u5A34|\u5AFB \u5A34|\u5AFF \u5A73|\u5B00 \u59AB|\u5B03 \u5AAD|\u5B08 \u5A06|\u5B0B \u5A75|\u5B0C \u5A07|\u5B19 \u5AF1|\u5B21 \u5AD2|\u5B24 \u5B37|\u5B2A \u5AD4|\u5B30 \u5A74|\u5B38 \u5A76|\u5B43 \u5A18|\u5B4B \u36E4|\u5B4C \u5A08|\u5B6B \u5B59|\u5B78 \u5B66|\u5B7B \u{21967}|\u5B7F \u5B6A|\u5BAE \u5BAB|\u5BC0 \u91C7|\u5BE2 \u5BDD|\u5BE6 \u5B9E|\u5BE7 \u5B81|\u5BE9 \u5BA1|\u5BEB \u5199|\u5BEC \u5BBD|\u5BF5 \u5BA0|\u5BF6 \u5B9D|\u5C07 \u5C06|\u5C08 \u4E13|\u5C0B \u5BFB|\u5C0D \u5BF9|\u5C0E \u5BFC|\u5C37 \u5C34|\u5C46 \u5C4A|\u5C4D \u5C38|\u5C53 \u5C43|\u5C5C \u5C49|\u5C62 \u5C61|\u5C64 \u5C42|\u5C68 \u5C66|\u5C6C \u5C5E|\u5CA1 \u5188|\u5CEF \u5CF0|\u5CF4 \u5C98|\u5CF6 \u5C9B|\u5CFD \u5CE1|\u5D0D \u5D03|\u5D11 \u6606|\u5D17 \u5C97|\u5D19 \u4ED1|\u5D22 \u5CE5|\u5D2C \u5CBD|\u5D50 \u5C9A|\u5D57 \u5C81|\u5D7D \u{2BD87}|\u5D7E \u37E5|\u5D81 \u5D5D|\u5D84 \u5D2D|\u5D87 \u5C96|\u5D94 \u5D5A|\u5D97 \u5D02|\u5DA0 \u5CE4|\u5DA2 \u5CE3|\u5DA7 \u5CC4|\u5DA8 \u5CC3|\u5DAE \u5D04|\u5DB8 \u5D58|\u5DBA \u5CAD|\u5DBC \u5C7F|\u5DBD \u5CB3|\u5DCB \u5CBF|\u5DD2 \u5CE6|\u5DD4 \u5DC5|\u5DD6 \u5CA9|\u5DD8 \u{2AA58}|\u5DF0 \u5DEF|\u5DF9 \u537A|\u5E25 \u5E05|\u5E2B \u5E08|\u5E33 \u5E10|\u5E36 \u5E26|\u5E40 \u5E27|\u5E43 \u5E0F|\u5E53 \u384E|\u5E57 \u5E3C|\u5E58 \u5E3B|\u5E5F \u5E1C|\u5E63 \u5E01|\u5E6B \u5E2E|\u5E6C \u5E31|\u5E77 \u5E76|\u5E79 \u5E72|\u5E7E \u51E0|\u5EAB \u5E93|\u5EC1 \u5395|\u5EC2 \u53A2|\u5EC4 \u53A9|\u5EC8 \u53A6|\u5ECE \u5EBC|\u5ED5 \u836B|\u5EDA \u53A8|\u5EDD \u53AE|\u5EDE \u{2BDF7}|\u5EDF \u5E99|\u5EE0 \u5382|\u5EE1 \u5E91|\u5EE2 \u5E9F|\u5EE3 \u5E7F|\u5EE9 \u5EEA|\u5EEC \u5E90|\u5EF3 \u5385|\u5F12 \u5F11|\u5F14 \u540A|\u5F33 \u5F2A|\u5F35 \u5F20|\u5F37 \u5F3A|\u5F44 \u{2BE29}|\u5F46 \u522B|\u5F48 \u5F39|\u5F4C \u5F25|\u5F4E \u5F2F|\u5F54 \u5F55|\u5F59 \u6C47|\u5F60 \u5F5F|\u5F65 \u5F66|\u5F6B \u96D5|\u5F72 \u5F68|\u5F7F \u4F5B|\u5F8C \u540E|\u5F91 \u5F84|\u5F9E \u4ECE|\u5FA0 \u5F95|\u5FA9 \u590D|\u5FB5 \u5F81|\u5FB9 \u5F7B|\u6046 \u6052|\u6065 \u803B|\u6085 \u60A6|\u609E \u60AE|\u60B5 \u6005|\u60B6 \u95F7|\u60BD \u51C4|\u60E1 \u6076|\u60F1 \u607C|\u60F2 \u607D|\u60FB \u607B|\u611B \u7231|\u611C \u60EC|\u6128 \u60AB|\u6134 \u6006|\u6137 \u607A|\u613E \u5FFE|\u6144 \u6817|\u614B \u6001|\u614D \u6120|\u6158 \u60E8|\u615A \u60ED|\u615F \u6078|\u6163 \u60EF|\u6164 \u60AB|\u616A \u6004|\u616B \u6002|\u616E \u8651|\u6173 \u60AD|\u6176 \u5E86|\u617A \u396A|\u617C \u621A|\u617E \u6B32|\u6182 \u5FE7|\u618A \u60EB|\u6190 \u601C|\u6191 \u51ED|\u6192 \u6126|\u6196 \u616D|\u619A \u60EE|\u61A4 \u6124|\u61AB \u60AF|\u61AE \u6003|\u61B2 \u5BAA|\u61B6 \u5FC6|\u61C7 \u6073|\u61C9 \u5E94|\u61CC \u603F|\u61CD \u61D4|\u61DE \u8499|\u61DF \u603C|\u61E3 \u61D1|\u61E4 \u393D|\u61E8 \u6079|\u61F2 \u60E9|\u61F6 \u61D2|\u61F7 \u6000|\u61F8 \u60AC|\u61FA \u5FCF|\u61FC \u60E7|\u61FE \u6151|\u6200 \u604B|\u6207 \u6206|\u6214 \u620B|\u6227 \u6217|\u6229 \u622C|\u6230 \u6218|\u6231 \u622F|\u6232 \u620F|\u6236 \u6237|\u625E \u634D|\u62CB \u629B|\u62DA \u62FC|\u6329 \u635D|\u6331 \u6332|\u633E \u631F|\u6368 \u820D|\u636B \u626A|\u6371 \u6328|\u6372 \u5377|\u6383 \u626B|\u6384 \u62A1|\u6386 \u39CF|\u6397 \u631C|\u6399 \u6323|\u639B \u6302|\u63A1 \u91C7|\u63C0 \u62E3|\u63DA \u626C|\u63DB \u6362|\u63EE \u6325|\u63EF \u6404|\u640D \u635F|\u6416 \u6447|\u6417 \u6363|\u6427 \u6247|\u6435 \u63FE|\u6436 \u62A2|\u6451 \u63B4|\u645C \u63BC|\u645F \u6402|\u646F \u631A|\u6473 \u62A0|\u6476 \u629F|\u647A \u6298|\u647B \u63BA|\u6488 \u635E|\u648F \u6326|\u6490 \u6491|\u6493 \u6320|\u649D \u39D1|\u649F \u6322|\u64A3 \u63B8|\u64A5 \u62E8|\u64AB \u629A|\u64B2 \u6251|\u64B3 \u63FF|\u64BB \u631E|\u64BE \u631D|\u64BF \u6361|\u64C1 \u62E5|\u64C4 \u63B3|\u64C7 \u62E9|\u64CA \u51FB|\u64CB \u6321|\u64D3 \u39DF|\u64D4 \u62C5|\u64DA \u636E|\u64E0 \u6324|\u64E1 \u62AC|\u64E3 \u6363|\u64EC \u62DF|\u64EF \u6448|\u64F0 \u62E7|\u64F1 \u6401|\u64F2 \u63B7|\u64F4 \u6269|\u64F7 \u64B7|\u64FA \u6446|\u64FB \u64DE|\u64FC \u64B8|\u64FD \u39F0|\u64FE \u6270|\u6504 \u6445|\u6506 \u64B5|\u650F \u62E2|\u6514 \u62E6|\u6516 \u6484|\u6519 \u6400|\u651B \u64BA|\u651C \u643A|\u651D \u6444|\u6522 \u6512|\u6523 \u631B|\u6524 \u644A|\u652A \u6405|\u652C \u63FD|\u654E \u6559|\u6553 \u655A|\u6557 \u8D25|\u6558 \u53D9|\u6575 \u654C|\u6578 \u6570|\u6582 \u655B|\u6583 \u6BD9|\u6586 \u6569|\u6595 \u6593|\u65AC \u65A9|\u65B7 \u65AD|\u65BC \u4E8E|\u65C2 \u65D7|\u65E3 \u65E2|\u6607 \u5347|\u6642 \u65F6|\u6649 \u664B|\u665B \u{2C02A}|\u665D \u663C|\u6688 \u6655|\u6689 \u6656|\u6690 \u{2C029}|\u6698 \u65F8|\u66A2 \u7545|\u66AB \u6682|\u66C4 \u6654|\u66C6 \u5386|\u66C7 \u6619|\u66C9 \u6653|\u66CF \u5411|\u66D6 \u66A7|\u66E0 \u65F7|\u66E5 \u{23190}|\u66E8 \u663D|\u66EC \u6652|\u66F8 \u4E66|\u6703 \u4F1A|\u6725 \u{266E8}|\u6727 \u80E7|\u672E \u672F|\u6771 \u4E1C|\u67B4 \u62D0|\u67F5 \u6805|\u67FA \u62D0|\u67FB \u67E5|\u6871 \u{23415}|\u687F \u6746|\u6894 \u6800|\u6898 \u67A7|\u689C \u{2C0A9}|\u689D \u6761|\u689F \u67AD|\u68B2 \u68C1|\u68C4 \u5F03|\u68CA \u68CB|\u68D6 \u67A8|\u68D7 \u67A3|\u68DF \u680B|\u68E1 \u3B4E|\u68E7 \u6808|\u68F2 \u6816|\u68F6 \u68BE|\u690F \u6860|\u6932 \u3B4F|\u694A \u6768|\u6953 \u67AB|\u6968 \u6862|\u696D \u4E1A|\u6975 \u6781|\u6998 \u77E9|\u69A6 \u5E72|\u69AA \u6769|\u69AE \u8363|\u69B2 \u6985|\u69BF \u6864|\u69CB \u6784|\u69CD \u67AA|\u69D3 \u6760|\u69E4 \u68BF|\u69E7 \u6920|\u69E8 \u6901|\u69EE \u692E|\u69F3 \u6868|\u69F6 \u6922|\u69FC \u691D|\u6A01 \u6869|\u6A02 \u4E50|\u6A05 \u679E|\u6A11 \u6881|\u6A13 \u697C|\u6A19 \u6807|\u6A1E \u67A2|\u6A22 \u3B64|\u6A23 \u6837|\u6A27 \u699D|\u6A2B \u3B74|\u6A33 \u686A|\u6A38 \u6734|\u6A39 \u6811|\u6A3A \u6866|\u6A3F \u692B|\u6A48 \u6861|\u6A4B \u6865|\u6A5F \u673A|\u6A62 \u692D|\u6A6B \u6A2A|\u6A6F \u{234FF}|\u6A81 \u6AA9|\u6A89 \u67FD|\u6A94 \u6863|\u6A9C \u6867|\u6A9F \u69DA|\u6AA2 \u68C0|\u6AA3 \u6A2F|\u6AAE \u68BC|\u6AAF \u53F0|\u6AB3 \u69DF|\u6AB8 \u67E0|\u6ABB \u69DB|\u6AC3 \u67DC|\u6ACD \u{2C0CA}|\u6AD3 \u6A79|\u6ADA \u6988|\u6ADB \u6809|\u6ADD \u691F|\u6ADE \u6A7C|\u6ADF \u680E|\u6AE5 \u6A71|\u6AE7 \u69E0|\u6AE8 \u680C|\u6AEA \u67A5|\u6AEB \u6A65|\u6AEC \u6987|\u6AF1 \u8616|\u6AF3 \u680A|\u6AF8 \u6989|\u6AFB \u6A31|\u6B04 \u680F|\u6B05 \u6989|\u6B0A \u6743|\u6B0F \u6924|\u6B12 \u683E|\u6B13 \u{235CB}|\u6B16 \u6984|\u6B1E \u68C2|\u6B3D \u94A6|\u6B4E \u53F9|\u6B50 \u6B27|\u6B5F \u6B24|\u6B61 \u6B22|\u6B72 \u5C81|\u6B77 \u5386|\u6B78 \u5F52|\u6B7F \u6B81|\u6B98 \u6B8B|\u6B9E \u6B92|\u6BA4 \u6B87|\u6BA8 \u3C6E|\u6BAB \u6B9A|\u6BAD \u50F5|\u6BAE \u6B93|\u6BAF \u6BA1|\u6BB0 \u3C69|\u6BB2 \u6B7C|\u6BBA \u6740|\u6BBB \u58F3|\u6BBC \u58F3|\u6BC0 \u6BC1|\u6BC6 \u6BB4|\u6BFF \u6BF5|\u6C02 \u7266|\u6C08 \u6BE1|\u6C0C \u6C07|\u6C23 \u6C14|\u6C2B \u6C22|\u6C2C \u6C29|\u6C33 \u6C32|\u6C3E \u6CDB|\u6C4E \u6CDB|\u6C59 \u6C61|\u6C7A \u51B3|\u6C92 \u6CA1|\u6C96 \u51B2|\u6CC1 \u51B5|\u6CDD \u6EAF|\u6D29 \u6CC4|\u6D36 \u6C79|\u6D79 \u6D43|\u6D7F \u{2C1D9}|\u6D87 \u6CFE|\u6D97 \u6D9A|\u6DBC \u51C9|\u6DD2 \u51C4|\u6DDA \u6CEA|\u6DE5 \u6E0C|\u6DE8 \u51C0|\u6DE9 \u51CC|\u6DEA \u6CA6|\u6DF5 \u6E0A|\u6DF6 \u6D9E|\u6DFA \u6D45|\u6E19 \u6DA3|\u6E1B \u51CF|\u6E22 \u6CA8|\u6E26 \u6DA1|\u6E2C \u6D4B|\u6E3E \u6D51|\u6E4A \u51D1|\u6E4B \u{23C97}|\u6E5E \u6D48|\u6E67 \u6D8C|\u6E6F \u6C64|\u6E88 \u6CA9|\u6E96 \u51C6|\u6E9D \u6C9F|\u6EAB \u6E29|\u6EAE \u6D49|\u6EB3 \u6DA2|\u6EBC \u6E7F|\u6EC4 \u6CA7|\u6EC5 \u706D|\u6ECC \u6DA4|\u6ECE \u8365|\u6ED9 \u6C47|\u6EEC \u6CAA|\u6EEF \u6EDE|\u6EF2 \u6E17|\u6EF7 \u5364|\u6EF8 \u6D52|\u6EFB \u6D50|\u6EFE \u6EDA|\u6EFF \u6EE1|\u6F01 \u6E14|\u6F0A \u6E87|\u6F0D \u{2C1F9}|\u6F1A \u6CA4|\u6F22 \u6C49|\u6F23 \u6D9F|\u6F2C \u6E0D|\u6F32 \u6DA8|\u6F35 \u6E86|\u6F38 \u6E10|\u6F3F \u6D46|\u6F41 \u988D|\u6F51 \u6CFC|\u6F54 \u6D01|\u6F55 \u{23C98}|\u6F59 \u6CA9|\u6F5A \u3D0B|\u6F5B \u6F5C|\u6F64 \u6DA6|\u6F6F \u6D54|\u6F70 \u6E83|\u6F77 \u6ED7|\u6F7F \u6DA0|\u6F80 \u6DA9|\u6F86 \u6D47|\u6F87 \u6D9D|\u6F90 \u6C84|\u6F97 \u6DA7|\u6FA0 \u6E11|\u6FA4 \u6CFD|\u6FA6 \u6EEA|\u6FA9 \u6CF6|\u6FAB \u{2C1D5}|\u6FAE \u6D4D|\u6FB1 \u6DC0|\u6FBE \u3CE0|\u6FC1 \u6D4A|\u6FC3 \u6D53|\u6FC4 \u3CE1|\u6FC6 \u{23E23}|\u6FD5 \u6E7F|\u6FD8 \u6CDE|\u6FDA \u6E81|\u6FDB \u8499|\u6FDC \u6D55|\u6FDF \u6D4E|\u6FE4 \u6D9B|\u6FE7 \u3CD4|\u6FEB \u6EE5|\u6FF0 \u6F4D|\u6FF1 \u6EE8|\u6FFA \u6E85|\u6FFC \u6CFA|\u6FFE \u6EE4|\u7002 \u6F9B|\u7005 \u6EE2|\u7006 \u6E0E|\u7007 \u3CBF|\u7009 \u6CFB|\u700B \u6C88|\u700F \u6D4F|\u7015 \u6FD2|\u7018 \u6CF8|\u701D \u6CA5|\u701F \u6F47|\u7020 \u6F46|\u7026 \u6F74|\u7027 \u6CF7|\u7028 \u6FD1|\u7030 \u5F25|\u7032 \u6F4B|\u703E \u6F9C|\u7043 \u6CA3|\u7044 \u6EE0|\u7051 \u6D12|\u7052 \u{2ADFD}|\u7055 \u6F13|\u7058 \u6EE9|\u7059 \u{23EBC}|\u705D \u704F|\u7061 \u3CD5|\u7063 \u6E7E|\u7064 \u6EE6|\u7067 \u6EDF|\u7069 \u6EDF|\u707D \u707E|\u70BA \u4E3A|\u70CF \u4E4C|\u70F4 \u70C3|\u7121 \u65E0|\u7149 \u70BC|\u7152 \u709C|\u7159 \u70DF|\u7162 \u8315|\u7165 \u7115|\u7169 \u70E6|\u716C \u7080|\u7171 \u3DBD|\u7185 \u7174|\u7192 \u8367|\u7197 \u709D|\u71B0 \u{2C27C}|\u71B1 \u70ED|\u71B2 \u988E|\u71BE \u70BD|\u71C0 \u{2C2A4}|\u71C1 \u70E8|\u71C8 \u706F|\u71C9 \u7096|\u71D2 \u70E7|\u71D6 \u{2C288}|\u71D9 \u70EB|\u71DC \u7116|\u71DF \u8425|\u71E6 \u707F|\u71EC \u6BC1|\u71ED \u70DB|\u71F4 \u70E9|\u71F6 \u3DB6|\u71FB \u718F|\u71FC \u70EC|\u71FE \u7118|\u720D \u70C1|\u7210 \u7089|\u721B \u70C2|\u722D \u4E89|\u7232 \u4E3A|\u723A \u7237|\u723E \u5C14|\u7240 \u5E8A|\u7246 \u5899|\u7258 \u724D|\u7274 \u62B5|\u727D \u7275|\u7296 \u8366|\u729B \u7266|\u72A2 \u728A|\u72A7 \u727A|\u72C0 \u72B6|\u72F9 \u72ED|\u72FD \u72C8|\u7319 \u72F0|\u7336 \u72B9|\u733B \u72F2|\u7341 \u72B8|\u7343 \u5446|\u7344 \u72F1|\u7345 \u72EE|\u734E \u5956|\u7368 \u72EC|\u736A \u72EF|\u736B \u7303|\u736E \u72DD|\u7370 \u72DE|\u7371 \u3E8D|\u7372 \u83B7|\u7375 \u730E|\u7377 \u72B7|\u7378 \u517D|\u737A \u736D|\u737B \u732E|\u737C \u7315|\u7380 \u7321|\u73FE \u73B0|\u7431 \u96D5|\u743A \u73D0|\u743F \u73F2|\u744B \u73AE|\u7452 \u739A|\u7463 \u7410|\u7464 \u7476|\u7469 \u83B9|\u746A \u739B|\u7472 \u73B1|\u7489 \u740F|\u748A \u{2B7A9}|\u7495 \u{2C364}|\u7497 \u{2C361}|\u74A1 \u740E|\u74A3 \u7391|\u74A6 \u7477|\u74AB \u73F0|\u74AF \u3EC5|\u74B0 \u73AF|\u74B5 \u7399|\u74B8 \u7478|\u74BD \u73BA|\u74BF \u7487|\u74C5 \u{2C35B}|\u74CA \u743C|\u74CF \u73D1|\u74D4 \u748E|\u74DA \u74D2|\u74DB \u{24A7D}|\u750C \u74EF|\u7515 \u74EE|\u7522 \u4EA7|\u7523 \u4EA7|\u755D \u4EA9|\u7562 \u6BD5|\u756B \u753B|\u7570 \u5F02|\u7575 \u753B|\u7576 \u5F53|\u7587 \u7574|\u758A \u53E0|\u75D9 \u75C9|\u75E0 \u9178|\u75FE \u75B4|\u7602 \u75D6|\u760B \u75AF|\u760D \u75A1|\u7613 \u75EA|\u761E \u7617|\u7621 \u75AE|\u7627 \u759F|\u762E \u7606|\u7632 \u75AD|\u763A \u7618|\u763B \u7618|\u7642 \u7597|\u7646 \u75E8|\u7647 \u75EB|\u7649 \u7605|\u7652 \u6108|\u7658 \u75A0|\u765F \u762A|\u7661 \u75F4|\u7662 \u75D2|\u7664 \u7596|\u7665 \u75C7|\u7667 \u75AC|\u7669 \u765E|\u766C \u7663|\u766D \u763F|\u766E \u763E|\u7670 \u75C8|\u7671 \u762B|\u7672 \u766B|\u767C \u53D1|\u7681 \u7682|\u769A \u7691|\u76B0 \u75B1|\u76B8 \u76B2|\u76BA \u76B1|\u76C3 \u676F|\u76DC \u76D7|\u76DE \u76CF|\u76E1 \u5C3D|\u76E3 \u76D1|\u76E4 \u76D8|\u76E7 \u5362|\u76EA \u8361|\u771E \u771F|\u7725 \u7726|\u773E \u4F17|\u774D \u{2AFA2}|\u774F \u56F0|\u775C \u7741|\u775E \u7750|\u7798 \u770D|\u779C \u4056|\u779E \u7792|\u77B6 \u7786|\u77BC \u7751|\u77C7 \u8499|\u77D3 \u772C|\u77DA \u77A9|\u77EF \u77EB|\u7843 \u6731|\u785C \u7841|\u7864 \u7856|\u7868 \u7817|\u786F \u781A|\u7895 \u57FC|\u78A9 \u7855|\u78AD \u7800|\u78B8 \u781C|\u78BA \u786E|\u78BC \u7801|\u78BD \u40B5|\u78D1 \u7859|\u78DA \u7816|\u78E0 \u7875|\u78E3 \u789C|\u78E7 \u789B|\u78EF \u77F6|\u78FD \u7857|\u78FE \u40C5|\u7904 \u785A|\u790E \u7840|\u7910 \u{2C488}|\u7919 \u788D|\u7926 \u77FF|\u792A \u783A|\u792B \u783E|\u792C \u77FE|\u7931 \u783B|\u7955 \u79D8|\u797F \u7984|\u798D \u7978|\u798E \u796F|\u7995 \u794E|\u79A1 \u7943|\u79A6 \u5FA1|\u79AA \u7985|\u79AE \u793C|\u79B0 \u7962|\u79B1 \u7977|\u79BF \u79C3|\u79C8 \u7C7C|\u7A05 \u7A0E|\u7A08 \u79C6|\u7A0F \u4149|\u7A1C \u68F1|\u7A1F \u7980|\u7A2E \u79CD|\u7A31 \u79F0|\u7A40 \u8C37|\u7A47 \u415F|\u7A4C \u7A23|\u7A4D \u79EF|\u7A4E \u9896|\u7A60 \u79FE|\u7A61 \u7A51|\u7A62 \u79FD|\u7A69 \u7A33|\u7A6B \u83B7|\u7A6D \u7A5E|\u7AA9 \u7A9D|\u7AAA \u6D3C|\u7AAE \u7A77|\u7AAF \u7A91|\u7AB5 \u7A8E|\u7AB6 \u7AAD|\u7ABA \u7AA5|\u7AC4 \u7A9C|\u7AC5 \u7A8D|\u7AC7 \u7AA6|\u7AC8 \u7076|\u7ACA \u7A83|\u7AEA \u7AD6|\u7AF6 \u7ADE|\u7B46 \u7B14|\u7B4D \u7B0B|\u7B67 \u7B15|\u7B74 \u41F2|\u7B87 \u4E2A|\u7B8B \u7B3A|\u7B8F \u7B5D|\u7B9A \u672D|\u7BC0 \u8282|\u7BC4 \u8303|\u7BC9 \u7B51|\u7BCB \u7BA7|\u7BD4 \u7B7C|\u7BE0 \u7B7F|\u7BE2 \u{2C542}|\u7BE4 \u7B03|\u7BE9 \u7B5B|\u7BF3 \u7B5A|\u7BF8 \u{25BBE}|\u7C00 \u7BA6|\u7C0D \u7BD3|\u7C11 \u84D1|\u7C1E \u7BAA|\u7C21 \u7B80|\u7C23 \u7BD1|\u7C2B \u7BAB|\u7C39 \u7B5C|\u7C3D \u7B7E|\u7C3E \u5E18|\u7C43 \u7BEE|\u7C45 \u{25AE3}|\u7C4C \u7B79|\u7C54 \u4264|\u7C59 \u7B93|\u7C5B \u7BEF|\u7C5C \u7BA8|\u7C5F \u7C41|\u7C60 \u7B3C|\u7C64 \u7B7E|\u7C69 \u7B3E|\u7C6A \u7C16|\u7C6C \u7BF1|\u7C6E \u7BA9|\u7C72 \u5401|\u7CB5 \u7CA4|\u7CC9 \u7CBD|\u7CDD \u7CC1|\u7CDE \u7CAA|\u7CE7 \u7CAE|\u7CF0 \u56E2|\u7CF2 \u7C9D|\u7CF4 \u7C74|\u7CF6 \u7C9C|\u7CF9 \u7E9F|\u7CFE \u7EA0|\u7D00 \u7EAA|\u7D02 \u7EA3|\u7D03 \u{2C613}|\u7D04 \u7EA6|\u7D05 \u7EA2|\u7D06 \u7EA1|\u7D07 \u7EA5|\u7D08 \u7EA8|\u7D09 \u7EAB|\u7D0B \u7EB9|\u7D0D \u7EB3|\u7D10 \u7EBD|\u7D13 \u7EBE|\u7D14 \u7EAF|\u7D15 \u7EB0|\u7D16 \u7EBC|\u7D17 \u7EB1|\u7D18 \u7EAE|\u7D19 \u7EB8|\u7D1A \u7EA7|\u7D1B \u7EB7|\u7D1C \u7EAD|\u7D1D \u7EB4|\u7D1E \u{2C618}|\u7D21 \u7EBA|\u7D2C \u4337|\u7D2E \u624E|\u7D30 \u7EC6|\u7D31 \u7EC2|\u7D32 \u7EC1|\u7D33 \u7EC5|\u7D35 \u7EBB|\u7D39 \u7ECD|\u7D3A \u7EC0|\u7D3C \u7ECB|\u7D3F \u7ED0|\u7D40 \u7ECC|\u7D42 \u7EC8|\u7D43 \u5F26|\u7D44 \u7EC4|\u7D45 \u4339|\u7D46 \u7ECA|\u7D4E \u7ED7|\u7D50 \u7ED3|\u7D55 \u7EDD|\u7D5B \u7EE6|\u7D5D \u7ED4|\u7D5E \u7EDE|\u7D61 \u7EDC|\u7D62 \u7EDA|\u7D66 \u7ED9|\u7D68 \u7ED2|\u7D6A \u{2C621}|\u7D70 \u7ED6|\u7D71 \u7EDF|\u7D72 \u4E1D|\u7D73 \u7EDB|\u7D76 \u7EDD|\u7D79 \u7EE2|\u7D7A \u{2B128}|\u7D81 \u7ED1|\u7D83 \u7EE1|\u7D84 \u{2C62B}|\u7D86 \u7EE0|\u7D88 \u7EE8|\u7D89 \u7EE3|\u7D8C \u7EE4|\u7D8E \u{2C629}|\u7D8F \u7EE5|\u7D90 \u433C|\u7D91 \u6346|\u7D93 \u7ECF|\u7D96 \u{2B127}|\u7D9C \u7EFC|\u7D9D \u{2C62D}|\u7D9E \u7F0D|\u7DA0 \u7EFF|\u7DA1 \u{2B7C5}|\u7DA2 \u7EF8|\u7DA3 \u7EFB|\u7DA7 \u{2C62F}|\u7DAA \u{2C62C}|\u7DAB \u7EBF|\u7DAC \u7EF6|\u7DAD \u7EF4|\u7DAF \u7EF9|\u7DB0 \u7EFE|\u7DB1 \u7EB2|\u7DB2 \u7F51|\u7DB3 \u7EF7|\u7DB4 \u7F00|\u7DB5 \u5F69|\u7DB8 \u7EB6|\u7DB9 \u7EFA|\u7DBA \u7EEE|\u7DBB \u7EFD|\u7DBD \u7EF0|\u7DBE \u7EEB|\u7DBF \u7EF5|\u7DC4 \u7EF2|\u7DC7 \u7F01|\u7DCA \u7D27|\u7DCB \u7EEF|\u7DD1 \u7EFF|\u7DD2 \u7EEA|\u7DD3 \u7EEC|\u7DD4 \u7EF1|\u7DD7 \u7F03|\u7DD8 \u7F04|\u7DD9 \u7F02|\u7DDA \u7EBF|\u7DDD \u7F09|\u7DDE \u7F0E|\u7DE0 \u7F14|\u7DE1 \u7F17|\u7DE3 \u7F18|\u7DE6 \u7F0C|\u7DE8 \u7F16|\u7DE9 \u7F13|\u7DEC \u7F05|\u7DEF \u7EAC|\u7DF1 \u7F11|\u7DF2 \u7F08|\u7DF4 \u7EC3|\u7DF6 \u7F0F|\u7DF9 \u7F07|\u7DFB \u81F4|\u7DFC \u7F0A|\u7E08 \u8426|\u7E09 \u7F19|\u7E0A \u7F22|\u7E0B \u7F12|\u7E10 \u7EC9|\u7E11 \u7F23|\u7E15 \u7F0A|\u7E17 \u7F1E|\u7E1B \u7F1A|\u7E1D \u7F1C|\u7E1E \u7F1F|\u7E1F \u7F1B|\u7E23 \u53BF|\u7E27 \u7EE6|\u7E2B \u7F1D|\u7E2D \u7F21|\u7E2E \u7F29|\u7E2F \u{2C642}|\u7E31 \u7EB5|\u7E32 \u7F27|\u7E33 \u4338|\u7E34 \u7EA4|\u7E35 \u7F26|\u7E36 \u7D77|\u7E37 \u7F15|\u7E39 \u7F25|\u7E3D \u603B|\u7E3E \u7EE9|\u7E43 \u7EF7|\u7E45 \u7F2B|\u7E46 \u7F2A|\u7E52 \u7F2F|\u7E54 \u7EC7|\u7E55 \u7F2E|\u7E5A \u7F2D|\u7E5E \u7ED5|\u7E61 \u7EE3|\u7E62 \u7F0B|\u7E69 \u7EF3|\u7E6A \u7ED8|\u7E6B \u7CFB|\u7E6D \u8327|\u7E6E \u7F30|\u7E6F \u7F33|\u7E70 \u7F32|\u7E73 \u7F34|\u7E76 \u{2B137}|\u7E78 \u4341|\u7E79 \u7ECE|\u7E7B \u{26221}|\u7E7C \u7EE7|\u7E7D \u7F24|\u7E7E \u7F31|\u7E7F \u4340|\u7E81 \u{2B138}|\u7E86 \u{2C64A}|\u7E87 \u98A3|\u7E88 \u7F2C|\u7E8A \u7EA9|\u7E8C \u7EED|\u7E8D \u7D2F|\u7E8F \u7F20|\u7E93 \u7F28|\u7E94 \u624D|\u7E95 \u{2C64B}|\u7E96 \u7EA4|\u7E98 \u7F35|\u7E9C \u7F06|\u7F3D \u94B5|\u7F43 \u44E8|\u7F48 \u575B|\u7F4C \u7F42|\u7F4E \u575B|\u7F70 \u7F5A|\u7F75 \u9A82|\u7F77 \u7F62|\u7F85 \u7F57|\u7F86 \u7F74|\u7F88 \u7F81|\u7F8B \u8288|\u7FA3 \u7FA4|\u7FA5 \u7F9F|\u7FA8 \u7FA1|\u7FA9 \u4E49|\u7FB6 \u81BB|\u7FD2 \u4E60|\u7FEB \u73A9|\u7FEC \u7FDA|\u7FF9 \u7FD8|\u7FFD \u7FD9|\u802C \u8027|\u802E \u8022|\u8056 \u5723|\u805E \u95FB|\u806F \u8054|\u8070 \u806A|\u8072 \u58F0|\u8073 \u8038|\u8075 \u8069|\u8076 \u8042|\u8077 \u804C|\u8079 \u804D|\u807D \u542C|\u807E \u804B|\u8085 \u8083|\u8105 \u80C1|\u8108 \u8109|\u811B \u80EB|\u8123 \u5507|\u8129 \u4FEE|\u812B \u8131|\u8139 \u80C0|\u814E \u80BE|\u8156 \u80E8|\u8161 \u8136|\u8166 \u8111|\u816B \u80BF|\u8173 \u811A|\u8178 \u80A0|\u8183 \u817D|\u8195 \u8158|\u819A \u80A4|\u819E \u43DD|\u81A0 \u80F6|\u81A2 \u{2677C}|\u81A9 \u817B|\u81BD \u80C6|\u81BE \u810D|\u81BF \u8113|\u81C9 \u8138|\u81CD \u8110|\u81CF \u8191|\u81D8 \u814A|\u81DA \u80EA|\u81DF \u810F|\u81E0 \u8114|\u81E2 \u81DC|\u81E5 \u5367|\u81E8 \u4E34|\u81FA \u53F0|\u8207 \u4E0E|\u8208 \u5174|\u8209 \u4E3E|\u820A \u65E7|\u8216 \u94FA|\u8218 \u9986|\u8259 \u8231|\u8264 \u8223|\u8266 \u8230|\u826B \u823B|\u8271 \u8270|\u8277 \u8273|\u82BB \u520D|\u82E7 \u82CE|\u8332 \u5179|\u834A \u8346|\u838A \u5E84|\u8396 \u830E|\u83A2 \u835A|\u83A7 \u82CB|\u83EF \u534E|\u83F4 \u5EB5|\u83F8 \u70DF|\u8407 \u82CC|\u840A \u83B1|\u842C \u4E07|\u8434 \u835D|\u8435 \u83B4|\u8449 \u53F6|\u8452 \u836D|\u8464 \u836E|\u8466 \u82C7|\u846F \u836F|\u8477 \u8364|\u848D \u{2B1ED}|\u8490 \u641C|\u8493 \u83BC|\u8494 \u83B3|\u8495 \u8480|\u849E \u8385|\u84BC \u82CD|\u84C0 \u836A|\u84C6 \u5E2D|\u84CB \u76D6|\u84EE \u83B2|\u84EF \u82C1|\u84F4 \u83BC|\u84FD \u835C|\u8504 \u{2C72C}|\u8514 \u535C|\u8518 \u53C2|\u851E \u848C|\u8523 \u848B|\u8525 \u8471|\u8526 \u8311|\u852D \u836B|\u852F \u{2B21F}|\u853F \u{2B1ED}|\u8541 \u8368|\u8546 \u8487|\u854E \u835E|\u8552 \u836C|\u8553 \u82B8|\u8555 \u83B8|\u8558 \u835B|\u8562 \u8489|\u8569 \u8361|\u856A \u829C|\u856D \u8427|\u8577 \u84E3|\u8580 \u8570|\u8588 \u835F|\u858A \u84DF|\u858C \u8297|\u8591 \u59DC|\u8594 \u8537|\u8598 \u8359|\u859F \u83B6|\u85A6 \u8350|\u85A9 \u8428|\u85B3 \u44D5|\u85B4 \u82E7|\u85B5 \u44D3|\u85B9 \u82D4|\u85BA \u8360|\u85CD \u84DD|\u85CE \u8369|\u85DD \u827A|\u85E5 \u836F|\u85EA \u85AE|\u85ED \u44D6|\u85F4 \u8574|\u85F6 \u82C8|\u85F9 \u853C|\u85FA \u853A|\u8600 \u841A|\u8604 \u8572|\u8606 \u82A6|\u8607 \u82CF|\u860A \u8574|\u860B \u82F9|\u861A \u85D3|\u861E \u8539|\u861F \u{26ED5}|\u8622 \u830F|\u862D \u5170|\u863A \u84E0|\u863F \u841D|\u8646 \u8502|\u8649 \u{2C7C1}|\u8655 \u5904|\u865B \u865A|\u865C \u864F|\u865F \u53F7|\u8667 \u4E8F|\u866F \u866C|\u86FA \u86F1|\u86FB \u8715|\u8706 \u86AC|\u8740 \u{2C7FD}|\u8755 \u8680|\u875F \u732C|\u8766 \u867E|\u8768 \u8671|\u8778 \u8717|\u8784 \u86F3|\u879E \u8682|\u87A2 \u8424|\u87AE \u45D6|\u87BB \u877C|\u87BF \u8780|\u87C4 \u86F0|\u87C8 \u8748|\u87CE \u87A8|\u87E3 \u866E|\u87EC \u8749|\u87EF \u86F2|\u87F2 \u866B|\u87F3 \u{2B2BB}|\u87F6 \u86CF|\u87FB \u8681|\u8801 \u8683|\u8805 \u8747|\u8806 \u867F|\u880D \u874E|\u8810 \u86F4|\u8811 \u877E|\u8814 \u869D|\u881F \u8721|\u8823 \u86CE|\u8828 \u87CF|\u8831 \u86CA|\u8836 \u8695|\u883B \u86EE|\u8846 \u4F17|\u884A \u8511|\u8853 \u672F|\u8855 \u540C|\u885A \u80E1|\u885B \u536B|\u885D \u51B2|\u889E \u886E|\u88B7 \u5939|\u88CA \u8885|\u88CF \u91CC|\u88DC \u8865|\u88DD \u88C5|\u88E1 \u91CC|\u88FD \u5236|\u8907 \u590D|\u890C \u88C8|\u8918 \u8886|\u8932 \u88E4|\u8933 \u88E2|\u8938 \u891B|\u893B \u4EB5|\u8940 \u{2B300}|\u8947 \u88E5|\u8949 \u88E5|\u894F \u88AF|\u8956 \u8884|\u895D \u88E3|\u8960 \u88C6|\u8964 \u8934|\u896A \u889C|\u896C \u6446|\u896F \u886C|\u8972 \u88AD|\u8974 \u8955|\u8988 \u6838|\u898B \u89C1|\u898E \u89C3|\u898F \u89C4|\u8993 \u89C5|\u8996 \u89C6|\u8998 \u89C7|\u89A1 \u89CB|\u89A5 \u89CD|\u89A6 \u89CE|\u89AA \u4EB2|\u89AC \u89CA|\u89AF \u89CF|\u89B2 \u89D0|\u89B7 \u89D1|\u89BA \u89C9|\u89BD \u89C8|\u89BF \u89CC|\u89C0 \u89C2|\u89F4 \u89DE|\u89F6 \u89EF|\u89F8 \u89E6|\u8A01 \u8BA0|\u8A02 \u8BA2|\u8A03 \u8BA3|\u8A08 \u8BA1|\u8A0A \u8BAF|\u8A0C \u8BA7|\u8A0E \u8BA8|\u8A0F \u{2C8D9}|\u8A10 \u8BA6|\u8A12 \u8BB1|\u8A13 \u8BAD|\u8A15 \u8BAA|\u8A16 \u8BAB|\u8A17 \u6258|\u8A18 \u8BB0|\u8A1B \u8BB9|\u8A1D \u8BB6|\u8A1F \u8BBC|\u8A22 \u4723|\u8A23 \u8BC0|\u8A25 \u8BB7|\u8A29 \u8BBB|\u8A2A \u8BBF|\u8A2D \u8BBE|\u8A31 \u8BB8|\u8A34 \u8BC9|\u8A36 \u8BC3|\u8A3A \u8BCA|\u8A3B \u6CE8|\u8A3C \u8BC1|\u8A40 \u{27BAA}|\u8A41 \u8BC2|\u8A46 \u8BCB|\u8A4E \u8BB5|\u8A50 \u8BC8|\u8A52 \u8BD2|\u8A54 \u8BCF|\u8A55 \u8BC4|\u8A56 \u8BD0|\u8A57 \u8BC7|\u8A58 \u8BCE|\u8A5B \u8BC5|\u8A5D \u{2C8DE}|\u8A5E \u8BCD|\u8A60 \u548F|\u8A61 \u8BE9|\u8A62 \u8BE2|\u8A63 \u8BE3|\u8A66 \u8BD5|\u8A69 \u8BD7|\u8A6A \u{2C8F3}|\u8A6B \u8BE7|\u8A6C \u8BDF|\u8A6D \u8BE1|\u8A6E \u8BE0|\u8A70 \u8BD8|\u8A71 \u8BDD|\u8A72 \u8BE5|\u8A73 \u8BE6|\u8A75 \u8BDC|\u8A77 \u{2B363}|\u8A7C \u8BD9|\u8A7F \u8BD6|\u8A84 \u8BD4|\u8A85 \u8BDB|\u8A86 \u8BD3|\u8A87 \u5938|\u8A8C \u5FD7|\u8A8D \u8BA4|\u8A91 \u8BF3|\u8A92 \u8BF6|\u8A95 \u8BDE|\u8A98 \u8BF1|\u8A9A \u8BEE|\u8A9E \u8BED|\u8AA0 \u8BDA|\u8AA1 \u8BEB|\u8AA3 \u8BEC|\u8AA4 \u8BEF|\u8AA5 \u8BF0|\u8AA6 \u8BF5|\u8AA8 \u8BF2|\u8AAA \u8BF4|\u8AAC \u8BF4|\u8AB0 \u8C01|\u8AB2 \u8BFE|\u8AB6 \u8C07|\u8AB9 \u8BFD|\u8ABC \u8C0A|\u8ABE \u8A1A|\u8ABF \u8C03|\u8AC2 \u8C04|\u8AC4 \u8C06|\u8AC7 \u8C08|\u8AC9 \u8BFF|\u8ACB \u8BF7|\u8ACD \u8BE4|\u8ACF \u8BF9|\u8AD1 \u8BFC|\u8AD2 \u8C05|\u8AD3 \u{2C8E1}|\u8AD6 \u8BBA|\u8AD7 \u8C02|\u8ADB \u8C00|\u8ADC \u8C0D|\u8ADD \u8C1E|\u8ADE \u8C1D|\u8ADF \u{2C90A}|\u8AE1 \u8C25|\u8AE2 \u8BE8|\u8AE4 \u8C14|\u8AE6 \u8C1B|\u8AE7 \u8C10|\u8AEB \u8C0F|\u8AED \u8C15|\u8AEE \u54A8|\u8AF1 \u8BB3|\u8AF2 \u{2C907}|\u8AF3 \u8C19|\u8AF4 \u{2B36F}|\u8AF6 \u8C0C|\u8AF7 \u8BBD|\u8AF8 \u8BF8|\u8AFA \u8C1A|\u8AFC \u8C16|\u8AFE \u8BFA|\u8B00 \u8C0B|\u8B01 \u8C12|\u8B02 \u8C13|\u8B04 \u8A8A|\u8B05 \u8BCC|\u8B0A \u8C0E|\u8B0E \u8C1C|\u8B0F \u{2B372}|\u8B10 \u8C27|\u8B14 \u8C11|\u8B16 \u8C21|\u8B17 \u8C24|\u8B19 \u8C26|\u8B1A \u8C25|\u8B1B \u8BB2|\u8B1D \u8C22|\u8B20 \u8C23|\u8B21 \u8C23|\u8B28 \u8C1F|\u8B2B \u8C2A|\u8B2C \u8C2C|\u8B2D \u8C2B|\u8B33 \u8BB4|\u8B39 \u8C28|\u8B3E \u8C29|\u8B41 \u54D7|\u8B49 \u8BC1|\u8B4E \u8C32|\u8B4F \u8BA5|\u8B53 \u{2C91D}|\u8B56 \u8C2E|\u8B58 \u8BC6|\u8B59 \u8C2F|\u8B5A \u8C2D|\u8B5C \u8C31|\u8B5E \u{2B37D}|\u8B5F \u566A|\u8B6B \u8C35|\u8B6D \u6BC1|\u8B6F \u8BD1|\u8B70 \u8BAE|\u8B74 \u8C34|\u8B77 \u62A4|\u8B78 \u8BEA|\u8B7D \u8A89|\u8B7E \u8C2B|\u8B80 \u8BFB|\u8B85 \u8C09|\u8B8A \u53D8|\u8B8B \u8A5F|\u8B8C \u4729|\u8B8E \u96E0|\u8B92 \u8C17|\u8B93 \u8BA9|\u8B95 \u8C30|\u8B96 \u8C36|\u8B9A \u8D5E|\u8B9C \u8C20|\u8B9E \u8C33|\u8C3F \u6EAA|\u8C48 \u5C82|\u8C4E \u7AD6|\u8C50 \u4E30|\u8C54 \u8273|\u8C6C \u732A|\u8C76 \u8C6E|\u8C8D \u72F8|\u8C93 \u732B|\u8C99 \u4759|\u8C9D \u8D1D|\u8C9E \u8D1E|\u8C9F \u8D20|\u8CA0 \u8D1F|\u8CA1 \u8D22|\u8CA2 \u8D21|\u8CA7 \u8D2B|\u8CA8 \u8D27|\u8CA9 \u8D29|\u8CAA \u8D2A|\u8CAB \u8D2F|\u8CAC \u8D23|\u8CAF \u8D2E|\u8CB0 \u8D33|\u8CB2 \u8D40|\u8CB3 \u8D30|\u8CB4 \u8D35|\u8CB6 \u8D2C|\u8CB7 \u4E70|\u8CB8 \u8D37|\u8CBA \u8D36|\u8CBB \u8D39|\u8CBC \u8D34|\u8CBD \u8D3B|\u8CBF \u8D38|\u8CC0 \u8D3A|\u8CC1 \u8D32|\u8CC2 \u8D42|\u8CC3 \u8D41|\u8CC4 \u8D3F|\u8CC5 \u8D45|\u8CC7 \u8D44|\u8CC8 \u8D3E|\u8CCA \u8D3C|\u8CD1 \u8D48|\u8CD2 \u8D4A|\u8CD3 \u5BBE|\u8CD5 \u8D47|\u8CD9 \u8D52|\u8CDA \u8D49|\u8CDC \u8D50|\u8CDE \u8D4F|\u8CE0 \u8D54|\u8CE1 \u8D53|\u8CE2 \u8D24|\u8CE3 \u5356|\u8CE4 \u8D31|\u8CE6 \u8D4B|\u8CE7 \u8D55|\u8CEA \u8D28|\u8CEB \u8D4D|\u8CEC \u8D26|\u8CED \u8D4C|\u8CF0 \u4790|\u8CF4 \u8D56|\u8CF5 \u8D57|\u8CFA \u8D5A|\u8CFB \u8D59|\u8CFC \u8D2D|\u8CFD \u8D5B|\u8CFE \u8D5C|\u8D04 \u8D3D|\u8D05 \u8D58|\u8D07 \u8D5F|\u8D08 \u8D60|\u8D0A \u8D5E|\u8D0B \u8D5D|\u8D0D \u8D61|\u8D0F \u8D62|\u8D10 \u8D46|\u8D13 \u8D43|\u8D14 \u8D51|\u8D16 \u8D4E|\u8D17 \u8D5D|\u8D1B \u8D63|\u8D1C \u8D43|\u8D6C \u8D6A|\u8D95 \u8D76|\u8D99 \u8D75|\u8DA8 \u8D8B|\u8DB2 \u8DB1|\u8DE1 \u8FF9|\u8E10 \u8DF5|\u8E30 \u903E|\u8E34 \u8E0A|\u8E4C \u8DC4|\u8E55 \u8DF8|\u8E5F \u8FF9|\u8E60 \u8DD6|\u8E63 \u8E52|\u8E64 \u8E2A|\u8E7A \u8DF7|\u8E82 \u8DF6|\u8E89 \u8DB8|\u8E8A \u8E0C|\u8E8B \u8DFB|\u8E8D \u8DC3|\u8E8E \u47E2|\u8E91 \u8E2F|\u8E92 \u8DDE|\u8E93 \u8E2C|\u8E95 \u8E70|\u8E9A \u8DF9|\u8EA1 \u8E51|\u8EA5 \u8E7F|\u8EA6 \u8E9C|\u8EAA \u8E8F|\u8EC0 \u8EAF|\u8ECA \u8F66|\u8ECB \u8F67|\u8ECC \u8F68|\u8ECD \u519B|\u8ECF \u{2B404}|\u8ED1 \u8F6A|\u8ED2 \u8F69|\u8ED4 \u8F6B|\u8EDB \u8F6D|\u8EDD \u{2CA02}|\u8EDF \u8F6F|\u8EE4 \u8F77|\u8EEB \u8F78|\u8EF2 \u8F71|\u8EF8 \u8F74|\u8EF9 \u8F75|\u8EFA \u8F7A|\u8EFB \u8F72|\u8EFC \u8F76|\u8EFE \u8F7C|\u8F03 \u8F83|\u8F04 \u{28408}|\u8F05 \u8F82|\u8F07 \u8F81|\u8F08 \u8F80|\u8F09 \u8F7D|\u8F0A \u8F7E|\u8F0B \u{2AA36}|\u8F12 \u8F84|\u8F13 \u633D|\u8F14 \u8F85|\u8F15 \u8F7B|\u8F17 \u{2B410}|\u8F1B \u8F86|\u8F1C \u8F8E|\u8F1D \u8F89|\u8F1E \u8F8B|\u8F1F \u8F8D|\u8F25 \u8F8A|\u8F26 \u8F87|\u8F29 \u8F88|\u8F2A \u8F6E|\u8F2C \u8F8C|\u8F2E \u{2B413}|\u8F2F \u8F91|\u8F33 \u8F8F|\u8F36 \u{2CA0E}|\u8F38 \u8F93|\u8F3B \u8F90|\u8F3C \u8F92|\u8F3E \u8F97|\u8F3F \u8206|\u8F40 \u8F92|\u8F42 \u6BC2|\u8F44 \u8F96|\u8F45 \u8F95|\u8F46 \u8F98|\u8F49 \u8F6C|\u8F4D \u8F99|\u8F4E \u8F7F|\u8F54 \u8F9A|\u8F5F \u8F70|\u8F61 \u8F94|\u8F62 \u8F79|\u8F64 \u8F73|\u8FA6 \u529E|\u8FAD \u8F9E|\u8FAE \u8FAB|\u8FAF \u8FA9|\u8FB2 \u519C|\u8FF4 \u56DE|\u9015 \u5F84|\u9019 \u8FD9|\u9023 \u8FDE|\u9031 \u5468|\u9032 \u8FDB|\u904A \u6E38|\u904B \u8FD0|\u904E \u8FC7|\u9054 \u8FBE|\u9055 \u8FDD|\u9059 \u9065|\u905C \u900A|\u905E \u9012|\u9060 \u8FDC|\u9061 \u6EAF|\u9069 \u9002|\u9072 \u8FDF|\u9076 \u7ED5|\u9077 \u8FC1|\u9078 \u9009|\u907A \u9057|\u907C \u8FBD|\u9081 \u8FC8|\u9084 \u8FD8|\u9087 \u8FE9|\u908A \u8FB9|\u908F \u903B|\u9090 \u9026|\u90DF \u90CF|\u90F5 \u90AE|\u9106 \u90D3|\u9109 \u4E61|\u9112 \u90B9|\u9114 \u90AC|\u9116 \u90E7|\u9127 \u9093|\u9129 \u{2CA7D}|\u912D \u90D1|\u9130 \u90BB|\u9132 \u90F8|\u9133 \u{2B461}|\u9134 \u90BA|\u9136 \u90D0|\u913A \u909D|\u9147 \u9142|\u9148 \u90E6|\u9183 \u814C|\u9196 \u915D|\u919C \u4E11|\u919E \u915D|\u919F \u848F|\u91A3 \u7CD6|\u91AB \u533B|\u91AC \u9171|\u91B1 \u9166|\u91B2 \u{2CAA9}|\u91C0 \u917F|\u91C1 \u8845|\u91C3 \u917E|\u91C5 \u917D|\u91CB \u91CA|\u91D0 \u5398|\u91D2 \u9485|\u91D3 \u9486|\u91D4 \u9487|\u91D5 \u948C|\u91D7 \u948A|\u91D8 \u9489|\u91D9 \u948B|\u91DD \u9488|\u91E3 \u9493|\u91E4 \u9490|\u91E6 \u6263|\u91E7 \u948F|\u91E9 \u9492|\u91F4 \u{2CB29}|\u91F5 \u9497|\u91F7 \u948D|\u91F9 \u9495|\u91FA \u948E|\u91FE \u497A|\u91FF \u{2CB31}|\u9200 \u94AF|\u9201 \u94AB|\u9203 \u9498|\u9204 \u94AD|\u9205 \u94A5|\u9207 \u{2B4E7}|\u9208 \u949A|\u9209 \u94A0|\u920D \u949D|\u920E \u94A9|\u9210 \u94A4|\u9211 \u94A3|\u9212 \u9491|\u9214 \u949E|\u9215 \u94AE|\u921E \u94A7|\u9221 \u949F|\u9223 \u9499|\u9225 \u94AC|\u9226 \u949B|\u9227 \u94AA|\u922E \u94CC|\u9230 \u94C8|\u9233 \u94B6|\u9234 \u94C3|\u9237 \u94B4|\u9238 \u94B9|\u9239 \u94CD|\u923A \u94B0|\u923D \u94B8|\u923E \u94C0|\u923F \u94BF|\u9240 \u94BE|\u9245 \u5DE8|\u9246 \u94BB|\u9248 \u94CA|\u9249 \u94C9|\u924A \u{2CB3F}|\u924B \u94C7|\u924D \u94CB|\u9251 \u94C2|\u9255 \u94B7|\u9257 \u94B3|\u925A \u94C6|\u925B \u94C5|\u925D \u{2B7F7}|\u925E \u94BA|\u9262 \u94B5|\u9264 \u94A9|\u9265 \u{2CB38}|\u9266 \u94B2|\u9267 \u{2CB41}|\u926C \u94BC|\u926D \u94BD|\u926E \u{2CB39}|\u9273 \u952B|\u9276 \u94CF|\u9277 \u{2B7F9}|\u9278 \u94F0|\u927A \u94D2|\u927B \u94EC|\u927F \u94EA|\u9280 \u94F6|\u9283 \u94F3|\u9285 \u94DC|\u9288 \u{2B4EF}|\u928D \u94DA|\u9291 \u94E3|\u9293 \u94E8|\u9296 \u94E2|\u9298 \u94ED|\u929A \u94EB|\u929B \u94E6|\u929C \u8854|\u92A0 \u94D1|\u92A3 \u94F7|\u92A5 \u94F1|\u92A6 \u94DF|\u92A8 \u94F5|\u92A9 \u94E5|\u92AA \u94D5|\u92AB \u94EF|\u92AC \u94D0|\u92B1 \u94DE|\u92B3 \u9510|\u92B6 \u{28C47}|\u92B7 \u9500|\u92B9 \u9508|\u92BB \u9511|\u92BC \u9509|\u92C1 \u94DD|\u92C3 \u9512|\u92C5 \u950C|\u92C7 \u94A1|\u92CC \u94E4|\u92CF \u94D7|\u92D0 \u{2CB4E}|\u92D2 \u950B|\u92D7 \u{2B4F6}|\u92D9 \u94FB|\u92DD \u950A|\u92DF \u9513|\u92E3 \u94D8|\u92E4 \u9504|\u92E5 \u9503|\u92E6 \u9514|\u92E8 \u9507|\u92E9 \u94D3|\u92EA \u94FA|\u92ED \u9510|\u92EE \u94D6|\u92EF \u9506|\u92F0 \u9502|\u92F1 \u94FD|\u92F6 \u950D|\u92F8 \u952F|\u92F9 \u{2CB2E}|\u92FC \u94A2|\u9300 \u{2CB2D}|\u9301 \u951E|\u9304 \u5F55|\u9306 \u9516|\u9307 \u952B|\u9308 \u9529|\u930F \u94D4|\u9310 \u9525|\u9312 \u9515|\u9315 \u951F|\u9318 \u9524|\u9319 \u9531|\u931A \u94EE|\u931B \u951B|\u931E \u{2CB5A}|\u931F \u952C|\u9320 \u952D|\u9321 \u951C|\u9322 \u94B1|\u9324 \u{2B4F9}|\u9326 \u9526|\u9328 \u951A|\u9329 \u9520|\u932B \u9521|\u932E \u9522|\u932F \u9519|\u9332 \u5F55|\u9333 \u9530|\u9336 \u8868|\u9338 \u94FC|\u933C \u954E|\u9340 \u951D|\u9341 \u9528|\u9343 \u952A|\u9345 \u94AB|\u9346 \u9494|\u9347 \u9534|\u9348 \u9533|\u934A \u70BC|\u934B \u9505|\u934D \u9540|\u9354 \u9537|\u9358 \u94E1|\u935A \u9496|\u935B \u953B|\u9360 \u953D|\u9364 \u9538|\u9365 \u9532|\u9369 \u9518|\u936C \u9539|\u936D \u{2CB64}|\u9370 \u953E|\u9375 \u952E|\u9376 \u9536|\u937A \u9517|\u937C \u9488|\u937E \u949F|\u9382 \u9541|\u9384 \u953F|\u9387 \u9545|\u938A \u9551|\u938C \u9570|\u9393 \u{2CB69}|\u9394 \u9555|\u9396 \u9501|\u9398 \u9549|\u939A \u9524|\u939B \u9548|\u939D \u{28C4F}|\u93A1 \u9543|\u93A2 \u94A8|\u93A3 \u84E5|\u93A6 \u954F|\u93A7 \u94E0|\u93A9 \u94E9|\u93AA \u953C|\u93AC \u9550|\u93AD \u9547|\u93AE \u9547|\u93B0 \u9552|\u93B2 \u954B|\u93B3 \u954D|\u93B5 \u9553|\u93B6 \u9FD4|\u93B8 \u954C|\u93BF \u954E|\u93C3 \u955E|\u93C7 \u65CB|\u93C8 \u94FE|\u93CC \u9546|\u93CD \u9559|\u93CF \u{2CB6C}|\u93D0 \u9560|\u93D1 \u955D|\u93D7 \u94FF|\u93D8 \u9535|\u93DC \u9557|\u93DD \u9558|\u93DE \u955B|\u93DF \u94F2|\u93E1 \u955C|\u93E2 \u9556|\u93E4 \u9542|\u93E8 \u933E|\u93F0 \u955A|\u93F5 \u94E7|\u93F7 \u9564|\u93F9 \u956A|\u93FA \u497D|\u93FB \u{2CB78}|\u93FD \u9508|\u9403 \u94D9|\u9404 \u{28C51}|\u9407 \u{2B50D}|\u940B \u94F4|\u940D \u{2B50E}|\u940F \u{28C54}|\u9410 \u9563|\u9412 \u94F9|\u9413 \u9566|\u9414 \u9561|\u9418 \u949F|\u9419 \u956B|\u941D \u9562|\u9420 \u9568|\u9425 \u4985|\u9426 \u950E|\u9427 \u950F|\u9428 \u9544|\u9429 \u{2CB7C}|\u942B \u954C|\u942E \u9570|\u942F \u4983|\u9432 \u956F|\u9433 \u956D|\u9435 \u94C1|\u9436 \u956E|\u9438 \u94CE|\u943A \u94DB|\u943D \u{2B7FC}|\u943F \u9571|\u9444 \u94F8|\u944A \u956C|\u944C \u9554|\u9451 \u9274|\u9452 \u9274|\u9454 \u9572|\u9455 \u9527|\u945E \u9574|\u9460 \u94C4|\u9463 \u9573|\u9465 \u9565|\u946A \u{2CB3B}|\u946D \u9567|\u9470 \u94A5|\u9471 \u9575|\u9472 \u9576|\u9477 \u954A|\u9479 \u9569|\u947C \u9523|\u947D \u94BB|\u947E \u92AE|\u947F \u51FF|\u9481 \u9562|\u9482 \u954B|\u9577 \u957F|\u9580 \u95E8|\u9582 \u95E9|\u9583 \u95EA|\u9586 \u95EB|\u9588 \u95EC|\u9589 \u95ED|\u958B \u5F00|\u958C \u95F6|\u958E \u95F3|\u958F \u95F0|\u9591 \u95F2|\u9592 \u95F2|\u9593 \u95F4|\u9594 \u95F5|\u9598 \u95F8|\u95A1 \u9602|\u95A3 \u9601|\u95A4 \u5408|\u95A5 \u9600|\u95A8 \u95FA|\u95A9 \u95FD|\u95AB \u9603|\u95AC \u9606|\u95AD \u95FE|\u95B1 \u9605|\u95B2 \u9605|\u95B6 \u960A|\u95B9 \u9609|\u95BB \u960E|\u95BC \u960F|\u95BD \u960D|\u95BE \u9608|\u95BF \u960C|\u95C3 \u9612|\u95C6 \u677F|\u95C7 \u6697|\u95C8 \u95F1|\u95C9 \u{2CBB1}|\u95CA \u9614|\u95CB \u9615|\u95CC \u9611|\u95CD \u9607|\u95D0 \u9617|\u95D1 \u{2B536}|\u95D2 \u9618|\u95D3 \u95FF|\u95D4 \u9616|\u95D5 \u9619|\u95D6 \u95EF|\u95DC \u5173|\u95DE \u961A|\u95E0 \u9613|\u95E1 \u9610|\u95E2 \u8F9F|\u95E4 \u961B|\u95E5 \u95FC|\u9658 \u9649|\u965D \u9655|\u965E \u5347|\u9663 \u9635|\u9670 \u9634|\u9673 \u9648|\u9678 \u9646|\u967D \u9633|\u9689 \u9667|\u968A \u961F|\u968E \u9636|\u9691 \u{2CBBF}|\u9695 \u9668|\u969B \u9645|\u96A4 \u{2CBCE}|\u96A8 \u968F|\u96AA \u9669|\u96AE \u{2CBC0}|\u96AF \u9666|\u96B1 \u9690|\u96B4 \u9647|\u96B8 \u96B6|\u96BB \u53EA|\u96CB \u96BD|\u96D6 \u867D|\u96D9 \u53CC|\u96DB \u96CF|\u96DC \u6742|\u96DE \u9E21|\u96E2 \u79BB|\u96E3 \u96BE|\u96F2 \u4E91|\u96FB \u7535|\u9711 \u6CBE|\u9722 \u9721|\u9727 \u96FE|\u973D \u9701|\u9742 \u96F3|\u9744 \u972D|\u9746 \u53C7|\u9748 \u7075|\u9749 \u53C6|\u975A \u9753|\u975C \u9759|\u975D \u9754|\u9766 \u817C|\u9768 \u9765|\u978F \u5DE9|\u979D \u7EF1|\u97A6 \u79CB|\u97BD \u9792|\u97C1 \u7F30|\u97C3 \u9791|\u97C6 \u5343|\u97C9 \u97AF|\u97CB \u97E6|\u97CC \u97E7|\u97CD \u97E8|\u97D3 \u97E9|\u97D9 \u97EA|\u97DC \u97EC|\u97DD \u97B2|\u97DE \u97EB|\u97FB \u97F5|\u97FF \u54CD|\u9801 \u9875|\u9802 \u9876|\u9803 \u9877|\u9805 \u9879|\u9806 \u987A|\u9807 \u9878|\u9808 \u987B|\u980A \u987C|\u980C \u9882|\u980D \u{2B806}|\u980E \u9880|\u980F \u9883|\u9810 \u9884|\u9811 \u987D|\u9812 \u9881|\u9813 \u987F|\u9814 \u{2CC56}|\u9817 \u9887|\u9818 \u9886|\u981C \u988C|\u9820 \u{2CC5F}|\u9821 \u9889|\u9824 \u9890|\u9826 \u988F|\u982B \u{2B5AF}|\u982D \u5934|\u982E \u9892|\u9830 \u988A|\u9832 \u988B|\u9834 \u9895|\u9835 \u{2B5B3}|\u9837 \u9894|\u9838 \u9888|\u9839 \u9893|\u983B \u9891|\u983D \u9893|\u9846 \u9897|\u984C \u9898|\u984D \u989D|\u984E \u989A|\u984F \u989C|\u9852 \u9899|\u9853 \u989B|\u9854 \u989C|\u9857 \u{2B5AE}|\u9858 \u613F|\u9859 \u98A1|\u985B \u98A0|\u985E \u7C7B|\u9862 \u989F|\u9865 \u98A2|\u9867 \u987E|\u986B \u98A4|\u986C \u98A5|\u986F \u663E|\u9870 \u98A6|\u9871 \u9885|\u9873 \u989E|\u9874 \u98A7|\u98A8 \u98CE|\u98AD \u98D0|\u98AE \u98D1|\u98AF \u98D2|\u98B1 \u53F0|\u98B3 \u522E|\u98B6 \u98D3|\u98B8 \u98D4|\u98BA \u98CF|\u98BB \u98D6|\u98BC \u98D5|\u98C0 \u98D7|\u98C4 \u98D8|\u98C6 \u98D9|\u98C8 \u98DA|\u98DB \u98DE|\u98E0 \u9963|\u98E2 \u9965|\u98E3 \u9964|\u98E5 \u9966|\u98E9 \u9968|\u98EA \u996A|\u98EB \u996B|\u98ED \u996C|\u98EF \u996D|\u98F1 \u98E7|\u98F2 \u996E|\u98F4 \u9974|\u98FC \u9972|\u98FD \u9971|\u98FE \u9970|\u98FF \u9973|\u9903 \u997A|\u9904 \u9978|\u9905 \u997C|\u9908 \u7CCD|\u9909 \u9977|\u990A \u517B|\u990C \u9975|\u990E \u9979|\u990F \u997B|\u9911 \u997D|\u9912 \u9981|\u9913 \u997F|\u9915 \u9982|\u9916 \u997E|\u9917 \u{2B5E7}|\u9918 \u4F59|\u991A \u80B4|\u991B \u9984|\u991C \u9983|\u991E \u996F|\u9921 \u9985|\u9928 \u9986|\u992C \u7CCA|\u9931 \u7CC7|\u9933 \u9967|\u9935 \u5582|\u9936 \u9989|\u9937 \u9987|\u9938 \u{2980C}|\u993A \u998E|\u993C \u9969|\u993E \u998F|\u993F \u998A|\u9941 \u998C|\u9943 \u998D|\u9945 \u9992|\u9948 \u9990|\u9949 \u9991|\u994A \u9993|\u994B \u9988|\u994C \u9994|\u9951 \u9965|\u9952 \u9976|\u9957 \u98E8|\u9958 \u{2B5F4}|\u995C \u990D|\u995E \u998B|\u9962 \u9995|\u99AC \u9A6C|\u99AD \u9A6D|\u99AE \u51AF|\u99B1 \u9A6E|\u99B3 \u9A70|\u99B4 \u9A6F|\u99B9 \u9A72|\u99BC \u{2B61C}|\u99C1 \u9A73|\u99C3 \u{2B61D}|\u99C9 \u{2CCF6}|\u99D0 \u9A7B|\u99D1 \u9A7D|\u99D2 \u9A79|\u99D3 \u{2CCF5}|\u99D4 \u9A75|\u99D5 \u9A7E|\u99D8 \u9A80|\u99D9 \u9A78|\u99DB \u9A76|\u99DD \u9A7C|\u99DF \u9A77|\u99E1 \u9A82|\u99E2 \u9A88|\u99EA \u{2CCFD}|\u99ED \u9A87|\u99F0 \u9A83|\u99F1 \u9A86|\u99F8 \u9A8E|\u99FC \u{2CCFF}|\u99FF \u9A8F|\u9A01 \u9A8B|\u9A02 \u9A8D|\u9A04 \u{2B627}|\u9A05 \u9A93|\u9A0A \u{2B626}|\u9A0C \u9A94|\u9A0D \u9A92|\u9A0E \u9A91|\u9A0F \u9A90|\u9A11 \u{2CD02}|\u9A16 \u9A9B|\u9A19 \u9A97|\u9A1E \u{2CD03}|\u9A20 \u{2B628}|\u9A24 \u9A99|\u9A27 \u4BC4|\u9A2B \u9A9E|\u9A2D \u9A98|\u9A2E \u9A9D|\u9A30 \u817E|\u9A31 \u{2B62C}|\u9A35 \u{2B62A}|\u9A36 \u9A7A|\u9A37 \u9A9A|\u9A38 \u9A9F|\u9A3E \u9AA1|\u9A40 \u84E6|\u9A41 \u9A9C|\u9A42 \u9A96|\u9A43 \u9AA0|\u9A44 \u9AA2|\u9A45 \u9A71|\u9A4A \u9A85|\u9A4C \u9A95|\u9A4D \u9A81|\u9A4E \u{2CD0A}|\u9A4F \u9AA3|\u9A55 \u9A84|\u9A57 \u9A8C|\u9A5A \u60CA|\u9A5B \u9A7F|\u9A5F \u9AA4|\u9A62 \u9A74|\u9A64 \u9AA7|\u9A65 \u9AA5|\u9A66 \u9AA6|\u9A6A \u9A8A|\u9A6B \u9A89|\u9AAF \u80AE|\u9ACF \u9AC5|\u9AD2 \u810F|\u9AD4 \u4F53|\u9AD5 \u9ACC|\u9AD6 \u9ACB|\u9AEE \u53D1|\u9B06 \u677E|\u9B0D \u80E1|\u9B1A \u987B|\u9B22 \u9B13|\u9B25 \u6597|\u9B27 \u95F9|\u9B28 \u54C4|\u9B29 \u960B|\u9B2E \u9604|\u9B31 \u90C1|\u9B39 \u9B36|\u9B4E \u9B49|\u9B58 \u9B47|\u9B5A \u9C7C|\u9B5B \u9C7D|\u9B5F \u{2B689}|\u9B62 \u9C7E|\u9B68 \u9C80|\u9B6F \u9C81|\u9B74 \u9C82|\u9B77 \u9C7F|\u9B7A \u9C84|\u9B80 \u{2CD8D}|\u9B81 \u9C85|\u9B83 \u9C86|\u9B86 \u{2B696}|\u9B88 \u{2CD8B}|\u9B8A \u9C8C|\u9B8B \u9C89|\u9B8D \u9C8F|\u9B8E \u9C87|\u9B90 \u9C90|\u9B91 \u9C8D|\u9B92 \u9C8B|\u9B93 \u9C8A|\u9B9A \u9C92|\u9B9C \u9C98|\u9B9D \u9C9E|\u9B9E \u9C95|\u9B9F \u{29F7E}|\u9BA0 \u{2CD8F}|\u9BA1 \u{2CD90}|\u9BA3 \u4C9F|\u9BA6 \u9C96|\u9BAA \u9C94|\u9BAB \u9C9B|\u9BAD \u9C91|\u9BAE \u9C9C|\u9BB3 \u9C93|\u9BB6 \u9CAA|\u9BB8 \u{29F83}|\u9BBA \u9C9D|\u9BC0 \u9CA7|\u9BC1 \u9CA0|\u9BC7 \u9CA9|\u9BC9 \u9CA4|\u9BCA \u9CA8|\u9BD2 \u9CAC|\u9BD4 \u9CBB|\u9BD5 \u9CAF|\u9BD6 \u9CAD|\u9BD7 \u9C9E|\u9BDB \u9CB7|\u9BDD \u9CB4|\u9BE1 \u9CB1|\u9BE2 \u9CB5|\u9BE4 \u9CB2|\u9BE7 \u9CB3|\u9BE8 \u9CB8|\u9BEA \u9CAE|\u9BEB \u9CB0|\u9BF0 \u9CB6|\u9BF4 \u9CBA|\u9BF7 \u9CC0|\u9BFB \u{2CD9F}|\u9BFD \u9CAB|\u9BFF \u9CCA|\u9C01 \u9CC8|\u9C02 \u9C97|\u9C03 \u9CC2|\u9C06 \u4CA0|\u9C08 \u9CBD|\u9C09 \u9CC7|\u9C0A \u{2CDA0}|\u9C0C \u4CA1|\u9C0D \u9CC5|\u9C0F \u9CBE|\u9C10 \u9CC4|\u9C12 \u9CC6|\u9C13 \u9CC3|\u9C1B \u9CC1|\u9C1C \u9CD2|\u9C1F \u9CD1|\u9C20 \u9CCB|\u9C23 \u9CA5|\u9C24 \u{2B695}|\u9C25 \u9CCF|\u9C27 \u4CA2|\u9C28 \u9CCE|\u9C29 \u9CD0|\u9C2D \u9CCD|\u9C2E \u9CC1|\u9C31 \u9CA2|\u9C32 \u9CCC|\u9C33 \u9CD3|\u9C35 \u9CD8|\u9C36 \u{2CDAD}|\u9C37 \u9CA6|\u9C39 \u9CA3|\u9C3A \u9CB9|\u9C3B \u9CD7|\u9C3C \u9CDB|\u9C3E \u9CD4|\u9C40 \u{2CDA8}|\u9C42 \u9CC9|\u9C45 \u9CD9|\u9C47 \u{29F8C}|\u9C48 \u9CD5|\u9C49 \u9CD6|\u9C52 \u9CDF|\u9C54 \u9CDD|\u9C56 \u9CDC|\u9C57 \u9CDE|\u9C58 \u9C9F|\u9C5A \u{2CDAE}|\u9C5D \u9CBC|\u9C5F \u9C8E|\u9C60 \u9C99|\u9C63 \u9CE3|\u9C64 \u9CE1|\u9C67 \u9CE2|\u9C68 \u9CBF|\u9C6D \u9C9A|\u9C6F \u9CE0|\u9C72 \u{2B6AD}|\u9C77 \u9CC4|\u9C78 \u9C88|\u9C7A \u9CA1|\u9CE5 \u9E1F|\u9CE7 \u51EB|\u9CE9 \u9E20|\u9CEC \u51EB|\u9CF2 \u9E24|\u9CF3 \u51E4|\u9CF4 \u9E23|\u9CF6 \u9E22|\u9CFE \u4D13|\u9D06 \u9E29|\u9D07 \u9E28|\u9D09 \u9E26|\u9D12 \u9E30|\u9D15 \u9E35|\u9D1B \u9E33|\u9D1D \u9E32|\u9D1E \u9E2E|\u9D1F \u9E31|\u9D23 \u9E2A|\u9D26 \u9E2F|\u9D28 \u9E2D|\u9D2F \u9E38|\u9D30 \u9E39|\u9D34 \u9E3B|\u9D37 \u4D15|\u9D3B \u9E3F|\u9D3F \u9E3D|\u9D41 \u4D14|\u9D42 \u9E3A|\u9D43 \u9E3C|\u9D4F \u{2CDD5}|\u9D50 \u9E40|\u9D51 \u9E43|\u9D52 \u9E46|\u9D53 \u9E41|\u9D5C \u9E48|\u9D5D \u9E45|\u9D5F \u{2B6ED}|\u9D60 \u9E44|\u9D61 \u9E49|\u9D6A \u9E4C|\u9D6C \u9E4F|\u9D6E \u9E50|\u9D6F \u9E4E|\u9D70 \u96D5|\u9D72 \u9E4A|\u9D77 \u9E53|\u9D7E \u9E4D|\u9D84 \u4D16|\u9D87 \u9E2B|\u9D89 \u9E51|\u9D8A \u9E52|\u9D93 \u9E4B|\u9D96 \u9E59|\u9D98 \u9E55|\u9D9A \u9E57|\u9DA0 \u{2CE18}|\u9DA1 \u9E56|\u9DA5 \u9E5B|\u9DA9 \u9E5C|\u9DAA \u4D17|\u9DAC \u9E27|\u9DAF \u83BA|\u9DB1 \u{2CE23}|\u9DB2 \u9E5F|\u9DB4 \u9E64|\u9DB9 \u9E60|\u9DBA \u9E61|\u9DBB \u9E58|\u9DBC \u9E63|\u9DBF \u9E5A|\u9DC0 \u9E5A|\u9DC1 \u9E62|\u9DC2 \u9E5E|\u9DC4 \u9E21|\u9DC9 \u4D18|\u9DCA \u9E5D|\u9DD3 \u9E67|\u9DD6 \u9E65|\u9DD7 \u9E25|\u9DD9 \u9E37|\u9DDA \u9E68|\u9DDF \u{2CE26}|\u9DE5 \u9E36|\u9DE6 \u9E6A|\u9DEB \u9E54|\u9DED \u{2CE2A}|\u9DEF \u9E69|\u9DF2 \u9E6B|\u9DF3 \u9E47|\u9DF4 \u9E47|\u9DF8 \u9E6C|\u9DF9 \u9E70|\u9DFA \u9E6D|\u9DFD \u9E34|\u9E02 \u3D89|\u9E07 \u9E6F|\u9E0A \u4D19|\u9E0C \u9E71|\u9E0F \u9E72|\u9E11 \u{2CE1A}|\u9E15 \u9E2C|\u9E18 \u9E74|\u9E1A \u9E66|\u9E1B \u9E73|\u9E1D \u9E42|\u9E1E \u9E3E|\u9E75 \u5364|\u9E79 \u54B8|\u9E7A \u9E7E|\u9E7C \u78B1|\u9E7D \u76D0|\u9E97 \u4E3D|\u9EA5 \u9EA6|\u9EA9 \u9EB8|\u9EAA \u9762|\u9EAB \u9762|\u9EAC \u{24FF2}|\u9EAF \u66F2|\u9EB3 \u{2A38C}|\u9EB4 \u66F2|\u9EB5 \u9762|\u9EBC \u4E48|\u9EBD \u4E48|\u9EC3 \u9EC4|\u9ECC \u9EC9|\u9EDE \u70B9|\u9EE8 \u515A|\u9EF2 \u9EEA|\u9EF4 \u9709|\u9EF6 \u9EE1|\u9EF7 \u9EE9|\u9EFD \u9EFE|\u9EFF \u9F0B|\u9F02 \u9F0C|\u9F09 \u9F0D|\u9F15 \u51AC|\u9F34 \u9F39|\u9F4A \u9F50|\u9F4B \u658B|\u9F4E \u8D4D|\u9F4F \u9F51|\u9F52 \u9F7F|\u9F54 \u9F80|\u9F55 \u9F81|\u9F57 \u9F82|\u9F58 \u{2CE7C}|\u9F59 \u9F85|\u9F5C \u9F87|\u9F5F \u9F83|\u9F60 \u9F86|\u9F61 \u9F84|\u9F63 \u51FA|\u9F66 \u9F88|\u9F67 \u556E|\u9F6A \u9F8A|\u9F6C \u9F89|\u9F6E \u{2CE88}|\u9F6F \u{2B81C}|\u9F72 \u9F8B|\u9F76 \u816D|\u9F77 \u9F8C|\u9F7C \u{2CE93}|\u9F8D \u9F99|\u9F8E \u5390|\u9F90 \u5E9E|\u9F91 \u4DAE|\u9F94 \u9F9A|\u9F95 \u9F9B|\u9F9C \u9F9F|\u9FC1 \u4724|\u9FD3 \u9FD2|\u{2005E} \u{2003E}|\u{20325} \u{20325}|\u{203E2} \u{203E2}|\u{2040A} \u{2040A}|\u{205E3} \u34C6|\u{20786} \u{20786}|\u{2080E} \u{2080E}|\u{20B19} \u{20B19}|\u{20F24} \u{20F24}|\u{20F43} \u{20F43}|\u{20FD5} \u{20FD5}|\u{210A1} \u{210A1}|\u{210C4} \u{210C4}|\u{210D5} \u{20D1B}|\u{210E4} \u{210E4}|\u{21114} \u{21114}|\u{21123} \u{21123}|\u{2114F} \u{20CA5}|\u{2116F} \u{2116F}|\u{2144D} \u{2BB7C}|\u{2146D} \u{212D7}|\u{214C1} \u{214C1}|\u{214FE} \u{212C0}|\u{21516} \u{21363}|\u{217B5} \u36DF|\u{217EB} \u{217EB}|\u{21839} \u36FF|\u{21883} \u36E0|\u{21B89} \u{21B5C}|\u{21BA3} \u{21B6C}|\u{21CF3} \u{21CC3}|\u{21E17} \u{21E17}|\u{21E6C} \u{21E6C}|\u{21ED5} \u5C81|\u{21F57} \u{21F57}|\u{21FB1} \u37DC|\u{21FD6} \u{21FD6}|\u{22370} \u{22370}|\u{2283C} \u{2283C}|\u{228D0} \u{228D0}|\u{228DA} \u{2261D}|\u{228ED} \u{228ED}|\u{22929} \u{22929}|\u{22931} \u{22931}|\u{2293F} \u{2293F}|\u{22BF7} \u{22BF7}|\u{22D92} \u{22D92}|\u{22DAB} \u{22ADE}|\u{22DEE} \u{22DEE}|\u{22E7F} \u{22B26}|\u{22EB3} \u{22EB3}|\u{23236} \u6685|\u{232CB} \u{232CB}|\u{23350} \u{23350}|\u{2364E} \u3B63|\u{2372C} \u{2372C}|\u{23755} \u{23755}|\u{237BB} \u{23613}|\u{23829} \u{2378E}|\u{23832} \u{23476}|\u{23BE9} \u{23BE9}|\u{23BF4} \u{23BF4}|\u{23BF6} \u6BF6|\u{23F4F} \u{23F4F}|\u{23FB7} \u3CE2|\u{23FC9} \u{23FC9}|\u{24063} \u{23EBD}|\u{24137} \u{24137}|\u{24176} \u{23DF7}|\u{24473} \u{24473}|\u{24479} \u{24479}|\u{2448E} \u{2448E}|\u{244BB} \u{244BB}|\u{244CC} \u{244CC}|\u{244CE} \u{244CE}|\u{244E9} \u{242B0}|\u{24600} \u{24600}|\u{246EE} \u{246EE}|\u{246F1} \u{246F1}|\u{24706} \u{24706}|\u{2482E} \u{2482E}|\u{2489F} \u{2489F}|\u{248BB} \u{248BB}|\u{24A42} \u{24A42}|\u{24ABA} \u3ED8|\u{24AE9} \u3ECF|\u{24B05} \u{24B05}|\u{24CF7} \u{24CF7}|\u{24CF8} \u{24CC4}|\u{24DC3} \u{24DC3}|\u{24E2B} \u{24E2B}|\u{24E94} \u{24E94}|\u{2529D} \u{2517F}|\u{25303} \u{25158}|\u{253DD} \u{253DD}|\u{25565} \u{25430}|\u{25585} \u{2542F}|\u{255B2} \u{255B2}|\u{255C7} \u{255C7}|\u{255FD} \u{2C497}|\u{25710} \u{25710}|\u{25730} \u{25730}|\u{257B5} \u{257B5}|\u{258A2} \u416A|\u{258B6} \u{258B6}|\u{258B7} \u{258B7}|\u{25A10} \u{25A10}|\u{25A82} \u{25A82}|\u{25BE4} \u{25BE4}|\u{25D28} \u{25D28}|\u{25D3C} \u{25D3C}|\u{25D43} \u{25D43}|\u{25D4A} \u{25D4A}|\u{25DBD} \u{25DBD}|\u{25E20} \u{25B8B}|\u{25EE6} \u{25EE6}|\u{25F3D} \u{25E65}|\u{25F56} \u{25F56}|\u{25FAF} \u{25FAF}|\u{25FCA} \u{25FCA}|\u{26016} \u{26016}|\u{26085} \u{26085}|\u{260C4} \u{260C4}|\u{260E9} \u{260E9}|\u{26147} \u{26147}|\u{26148} \u{26148}|\u{261B2} \u{261B2}|\u{26480} \u{26480}|\u{26516} \u{26516}|\u{26627} \u{21CD2}|\u{267FC} \u{267FC}|\u{26805} \u{26805}|\u{2685D} \u{2685D}|\u{26888} \u{26888}|\u{268CE} \u{267D7}|\u{269FA} \u{269FA}|\u{26A99} \u447D|\u{26ABD} \u{26ABD}|\u{26C4C} \u{26C4C}|\u{26F9F} \u{26F9F}|\u{27388} \u{27388}|\u{274AF} \u{274AF}|\u{27525} \u{27525}|\u{2755F} \u{2755F}|\u{27717} \u461E|\u{27735} \u464A|\u{2775E} \u461B|\u{277AB} \u{277AB}|\u{277C0} \u{27767}|\u{27874} \u{27874}|\u{27884} \u{27884}|\u{2799D} \u{2799D}|\u{279A7} \u{279A7}|\u{27A55} \u{27A55}|\u{27A59} \u4725|\u{27A7C} \u{27A7C}|\u{27ADD} \u{27ADD}|\u{27B24} \u{27B24}|\u{27B48} \u{27B48}|\u{27B79} \u{27B79}|\u{27CDF} \u{27CDF}|\u{27D73} \u478C|\u{27D94} \u{27D94}|\u{27DA7} \u478E|\u{27DCE} \u{27DCE}|\u{27E18} \u{27E18}|\u{27E48} \u{27E48}|\u{27F6F} \u{27F6F}|\u{28090} \u{28090}|\u{28123} \u{28123}|\u{2814D} \u{2814D}|\u{281AA} \u{281AA}|\u{281C1} \u{281C1}|\u{281DE} \u{281DE}|\u{281E4} \u{281E4}|\u{281F0} \u{281F0}|\u{281FD} \u{281FD}|\u{2820A} \u{2820A}|\u{2820C} \u{2820C}|\u{282B0} \u4880|\u{282B8} \u4881|\u{282BB} \u{282BB}|\u{282E2} \u4882|\u{28308} \u{28308}|\u{28370} \u{28370}|\u{2838C} \u{2838C}|\u{283AE} \u{283AE}|\u{283E0} \u{283E0}|\u{283E5} \u{283E5}|\u{287BA} \u{287BA}|\u{287CA} \u{287CA}|\u{288BF} \u{288BF}|\u{288C8} \u{288C8}|\u{288DE} \u{288DE}|\u{288E7} \u{288E7}|\u{2893B} \u{28930}|\u{2895B} \u{2895B}|\u{2895F} \u{2895F}|\u{289AB} \u4980|\u{289C0} \u{2CB4A}|\u{289DC} \u4981|\u{289F0} \u{289F0}|\u{289F1} \u{289F1}|\u{28A0F} \u{2CB5B}|\u{28A1B} \u{28A1B}|\u{28A22} \u{28A22}|\u{28A70} \u{28A70}|\u{28A95} \u{28A95}|\u{28AD2} \u{28AD2}|\u{28B16} \u{28B16}|\u{28B46} \u{2CB76}|\u{28B4E} \u{2CB73}|\u{28B56} \u{28B56}|\u{28B78} \u{28B78}|\u{28B82} \u{28B82}|\u{28BB3} \u{28BB3}|\u{28BC5} \u497F|\u{28BDF} \u{28BDF}|\u{28C03} \u{28C03}|\u{28C0B} \u{28C0B}|\u{28C25} \u{28C25}|\u{28C32} \u{28C32}|\u{28CB3} \u{28CB3}|\u{28CD1} \u{28CD1}|\u{28CD5} \u{28CD5}|\u{28D17} \u{28D17}|\u{28D39} \u{28D39}|\u{28D69} \u{28D69}|\u{28D78} \u{28D78}|\u{28D80} \u{28D80}|\u{28D8F} \u{28D8F}|\u{28DAE} \u{28DAE}|\u{28DB2} \u{28DB2}|\u{28DF2} \u{28DF2}|\u{28F33} \u{28F33}|\u{28F4F} \u{28F4F}|\u{29028} \u{29028}|\u{29159} \u{29159}|\u{29396} \u{29396}|\u{293A2} \u{293A2}|\u{293C2} \u{293C2}|\u{293E0} \u{293E0}|\u{293EA} \u{293EA}|\u{293F7} \u{293F7}|\u{29454} \u{29454}|\u{2948E} \u{2948E}|\u{294E3} \u{294E3}|\u{294E5} \u{294E5}|\u{29511} \u{29511}|\u{29533} \u{29533}|\u{295B0} \u{295B0}|\u{295C0} \u{295C0}|\u{295D3} \u{295D3}|\u{295F4} \u{295F4}|\u{29600} \u{29600}|\u{2961D} \u{2961D}|\u{29639} \u{29639}|\u{2963A} \u{2963A}|\u{29648} \u{29648}|\u{2969B} \u{2969B}|\u{296A5} \u{296A5}|\u{296A9} \u{296A9}|\u{296B5} \u{296B5}|\u{296C6} \u{296C6}|\u{296CC} \u{296CC}|\u{296E1} \u{296E1}|\u{296E9} \u{296E9}|\u{29707} \u{29707}|\u{29726} \u{29726}|\u{29735} \u{29735}|\u{29754} \u{29754}|\u{2977D} \u{2977D}|\u{29784} \u{29784}|\u{297A6} \u{297A6}|\u{297AF} \u4B6A|\u{297D0} \u{297D0}|\u{297D7} \u{297D7}|\u{29834} \u{29820}|\u{29863} \u{29863}|\u{2987A} \u{2987A}|\u{298A1} \u{298A1}|\u{298B4} \u{298B4}|\u{298B8} \u{298B8}|\u{298BE} \u{298BE}|\u{298CF} \u{298CF}|\u{298D1} \u4BC3|\u{298EB} \u{298EB}|\u{298F5} \u{298F5}|\u{298FA} \u{298FA}|\u{2990A} \u{2990A}|\u{29919} \u{29919}|\u{29932} \u{29932}|\u{29938} \u{29938}|\u{29944} \u{29944}|\u{29947} \u{29947}|\u{29949} \u{29949}|\u{29951} \u{29951}|\u{299A0} \u{299A0}|\u{299C6} \u{299C6}|\u{29B59} \u{29B59}|\u{29BC1} \u{29BC1}|\u{29BF3} \u{29BF3}|\u{29C00} \u{29C00}|\u{29C39} \u{29C39}|\u{29CE4} \u{29CE4}|\u{29D35} \u{29D35}|\u{29D66} \u{29D66}|\u{29D69} \u{29D69}|\u{29D79} \u{29D79}|\u{29D81} \u{29D81}|\u{29D98} \u4C9E|\u{29DB0} \u{29DB0}|\u{29DB1} \u{29DB1}|\u{29DF0} \u{29DF0}|\u{29E03} \u{29E03}|\u{29E04} \u{29E04}|\u{29E21} \u{29E21}|\u{29E26} \u{29E26}|\u{29ED7} \u{29ED7}|\u{29EEC} \u{29EEC}|\u{29EEE} \u{29EEE}|\u{29F36} \u{29F36}|\u{29F47} \u{29F47}|\u{29FC5} \u{29FC5}|\u{29FE4} \u{29FE4}|\u{29FEA} \u{29FEA}|\u{2A016} \u{2A016}|\u{2A026} \u{2A026}|\u{2A03E} \u{2A03E}|\u{2A048} \u{2A048}|\u{2A056} \u{2A056}|\u{2A086} \u{2A086}|\u{2A0CD} \u{2A0CD}|\u{2A0CF} \u{2A0CF}|\u{2A0D2} \u{2A0D2}|\u{2A0E7} \u{2A0E7}|\u{2A106} \u{2A106}|\u{2A115} \u{2A115}|\u{2A142} \u{2A142}|\u{2A1B7} \u{2A1B7}|\u{2A1F3} \u{2A1F3}|\u{2A23C} \u{2A23C}|\u{2A278} \u{2A278}|\u{2A2FF} \u{2A2FF}|\u{2A32D} \u{2A32D}|\u{2A360} \u{2A360}|\u{2A4F0} \u{2A4F0}|\u{2A535} \u{2A535}|\u{2A600} \u{2A600}|\u{2A62F} \u{2A62F}|\u{2A64F} \u{2A64F}|\u{2A7D6} \u{2A7D6}|\u{2ADD3} \u{2ADD3}|\u{2B4A1} \u{2B4A1}|\u{2B726} \u{2B726}|\u{30EDE} \u{30EDD}";
var v = "\uF900 \u8C48|\uF901 \u66F4|\uF902 \u8ECA|\uF903 \u8CC8|\uF904 \u6ED1|\uF905 \u4E32|\uF906 \u53E5|\uF907 \u9F9C|\uF908 \u9F9C|\uF909 \u5951|\uF90A \u91D1|\uF90B \u5587|\uF90C \u5948|\uF90D \u61F6|\uF90E \u7669|\uF90F \u7F85|\uF910 \u863F|\uF911 \u87BA|\uF912 \u88F8|\uF913 \u908F|\uF914 \u6A02|\uF915 \u6D1B|\uF916 \u70D9|\uF917 \u73DE|\uF918 \u843D|\uF919 \u916A|\uF91A \u99F1|\uF91B \u4E82|\uF91C \u5375|\uF91D \u6B04|\uF91E \u721B|\uF91F \u862D|\uF920 \u9E1E|\uF921 \u5D50|\uF922 \u6FEB|\uF923 \u85CD|\uF924 \u8964|\uF925 \u62C9|\uF926 \u81D8|\uF927 \u881F|\uF928 \u5ECA|\uF929 \u6717|\uF92A \u6D6A|\uF92B \u72FC|\uF92C \u90CE|\uF92D \u4F86|\uF92E \u51B7|\uF92F \u52DE|\uF930 \u64C4|\uF931 \u6AD3|\uF932 \u7210|\uF933 \u76E7|\uF934 \u8001|\uF935 \u8606|\uF936 \u865C|\uF937 \u8DEF|\uF938 \u9732|\uF939 \u9B6F|\uF93A \u9DFA|\uF93B \u788C|\uF93C \u797F|\uF93D \u7DA0|\uF93E \u83C9|\uF93F \u9304|\uF940 \u9E7F|\uF941 \u8AD6|\uF942 \u58DF|\uF943 \u5F04|\uF944 \u7C60|\uF945 \u807E|\uF946 \u7262|\uF947 \u78CA|\uF948 \u8CC2|\uF949 \u96F7|\uF94A \u58D8|\uF94B \u5C62|\uF94C \u6A13|\uF94D \u6DDA|\uF94E \u6F0F|\uF94F \u7D2F|\uF950 \u7E37|\uF951 \u964B|\uF952 \u52D2|\uF953 \u808B|\uF954 \u51DC|\uF955 \u51CC|\uF956 \u7A1C|\uF957 \u7DBE|\uF958 \u83F1|\uF959 \u9675|\uF95A \u8B80|\uF95B \u62CF|\uF95C \u6A02|\uF95D \u8AFE|\uF95E \u4E39|\uF95F \u5BE7|\uF960 \u6012|\uF961 \u7387|\uF962 \u7570|\uF963 \u5317|\uF964 \u78FB|\uF965 \u4FBF|\uF966 \u5FA9|\uF967 \u4E0D|\uF968 \u6CCC|\uF969 \u6578|\uF96A \u7D22|\uF96B \u53C3|\uF96C \u585E|\uF96D \u7701|\uF96E \u8449|\uF96F \u8AAA|\uF970 \u6BBA|\uF971 \u8FB0|\uF972 \u6C88|\uF973 \u62FE|\uF974 \u82E5|\uF975 \u63A0|\uF976 \u7565|\uF977 \u4EAE|\uF978 \u5169|\uF979 \u51C9|\uF97A \u6881|\uF97B \u7CE7|\uF97C \u826F|\uF97D \u8AD2|\uF97E \u91CF|\uF97F \u52F5|\uF980 \u5442|\uF981 \u5973|\uF982 \u5EEC|\uF983 \u65C5|\uF984 \u6FFE|\uF985 \u792A|\uF986 \u95AD|\uF987 \u9A6A|\uF988 \u9E97|\uF989 \u9ECE|\uF98A \u529B|\uF98B \u66C6|\uF98C \u6B77|\uF98D \u8F62|\uF98E \u5E74|\uF98F \u6190|\uF990 \u6200|\uF991 \u649A|\uF992 \u6F23|\uF993 \u7149|\uF994 \u7489|\uF995 \u79CA|\uF996 \u7DF4|\uF997 \u806F|\uF998 \u8F26|\uF999 \u84EE|\uF99A \u9023|\uF99B \u934A|\uF99C \u5217|\uF99D \u52A3|\uF99E \u54BD|\uF99F \u70C8|\uF9A0 \u88C2|\uF9A1 \u8AAA|\uF9A2 \u5EC9|\uF9A3 \u5FF5|\uF9A4 \u637B|\uF9A5 \u6BAE|\uF9A6 \u7C3E|\uF9A7 \u7375|\uF9A8 \u4EE4|\uF9A9 \u56F9|\uF9AA \u5BE7|\uF9AB \u5DBA|\uF9AC \u601C|\uF9AD \u73B2|\uF9AE \u7469|\uF9AF \u7F9A|\uF9B0 \u8046|\uF9B1 \u9234|\uF9B2 \u96F6|\uF9B3 \u9748|\uF9B4 \u9818|\uF9B5 \u4F8B|\uF9B6 \u79AE|\uF9B7 \u91B4|\uF9B8 \u96B8|\uF9B9 \u60E1|\uF9BA \u4E86|\uF9BB \u50DA|\uF9BC \u5BEE|\uF9BD \u5C3F|\uF9BE \u6599|\uF9BF \u6A02|\uF9C0 \u71CE|\uF9C1 \u7642|\uF9C2 \u84FC|\uF9C3 \u907C|\uF9C4 \u9F8D|\uF9C5 \u6688|\uF9C6 \u962E|\uF9C7 \u5289|\uF9C8 \u677B|\uF9C9 \u67F3|\uF9CA \u6D41|\uF9CB \u6E9C|\uF9CC \u7409|\uF9CD \u7559|\uF9CE \u786B|\uF9CF \u7D10|\uF9D0 \u985E|\uF9D1 \u516D|\uF9D2 \u622E|\uF9D3 \u9678|\uF9D4 \u502B|\uF9D5 \u5D19|\uF9D6 \u6DEA|\uF9D7 \u8F2A|\uF9D8 \u5F8B|\uF9D9 \u6144|\uF9DA \u6817|\uF9DB \u7387|\uF9DC \u9686|\uF9DD \u5229|\uF9DE \u540F|\uF9DF \u5C65|\uF9E0 \u6613|\uF9E1 \u674E|\uF9E2 \u68A8|\uF9E3 \u6CE5|\uF9E4 \u7406|\uF9E5 \u75E2|\uF9E6 \u7F79|\uF9E7 \u88CF|\uF9E8 \u88E1|\uF9E9 \u91CC|\uF9EA \u96E2|\uF9EB \u533F|\uF9EC \u6EBA|\uF9ED \u541D|\uF9EE \u71D0|\uF9EF \u7498|\uF9F0 \u85FA|\uF9F1 \u96A3|\uF9F2 \u9C57|\uF9F3 \u9E9F|\uF9F4 \u6797|\uF9F5 \u6DCB|\uF9F6 \u81E8|\uF9F7 \u7ACB|\uF9F8 \u7B20|\uF9F9 \u7C92|\uF9FA \u72C0|\uF9FB \u7099|\uF9FC \u8B58|\uF9FD \u4EC0|\uF9FE \u8336|\uF9FF \u523A|\uFA00 \u5207|\uFA01 \u5EA6|\uFA02 \u62D3|\uFA03 \u7CD6|\uFA04 \u5B85|\uFA05 \u6D1E|\uFA06 \u66B4|\uFA07 \u8F3B|\uFA08 \u884C|\uFA09 \u964D|\uFA0A \u898B|\uFA0B \u5ED3|\uFA0C \u5140|\uFA0D \u55C0|\uFA10 \u585A|\uFA12 \u6674|\uFA15 \u51DE|\uFA16 \u732A|\uFA17 \u76CA|\uFA18 \u793C|\uFA19 \u795E|\uFA1A \u7965|\uFA1B \u798F|\uFA1C \u9756|\uFA1D \u7CBE|\uFA1E \u7FBD|\uFA20 \u8612|\uFA22 \u8AF8|\uFA25 \u9038|\uFA26 \u90FD|\uFA2A \u98EF|\uFA2B \u98FC|\uFA2C \u9928|\uFA2D \u9DB4|\uFA2E \u90DE|\uFA2F \u96B7|\uFA30 \u4FAE|\uFA31 \u50E7|\uFA32 \u514D|\uFA33 \u52C9|\uFA34 \u52E4|\uFA35 \u5351|\uFA36 \u559D|\uFA37 \u5606|\uFA38 \u5668|\uFA39 \u5840|\uFA3A \u58A8|\uFA3B \u5C64|\uFA3C \u5C6E|\uFA3D \u6094|\uFA3E \u6168|\uFA3F \u618E|\uFA40 \u61F2|\uFA41 \u654F|\uFA42 \u65E2|\uFA43 \u6691|\uFA44 \u6885|\uFA45 \u6D77|\uFA46 \u6E1A|\uFA47 \u6F22|\uFA48 \u716E|\uFA49 \u722B|\uFA4A \u7422|\uFA4B \u7891|\uFA4C \u793E|\uFA4D \u7949|\uFA4E \u7948|\uFA4F \u7950|\uFA50 \u7956|\uFA51 \u795D|\uFA52 \u798D|\uFA53 \u798E|\uFA54 \u7A40|\uFA55 \u7A81|\uFA56 \u7BC0|\uFA57 \u7DF4|\uFA58 \u7E09|\uFA59 \u7E41|\uFA5A \u7F72|\uFA5B \u8005|\uFA5C \u81ED|\uFA5D \u8279|\uFA5E \u8279|\uFA5F \u8457|\uFA60 \u8910|\uFA61 \u8996|\uFA62 \u8B01|\uFA63 \u8B39|\uFA64 \u8CD3|\uFA65 \u8D08|\uFA66 \u8FB6|\uFA67 \u9038|\uFA68 \u96E3|\uFA69 \u97FF|\uFA6A \u983B|\uFA6B \u6075|\uFA6C \u{242EE}|\uFA6D \u8218|\uFA70 \u4E26|\uFA71 \u51B5|\uFA72 \u5168|\uFA73 \u4F80|\uFA74 \u5145|\uFA75 \u5180|\uFA76 \u52C7|\uFA77 \u52FA|\uFA78 \u559D|\uFA79 \u5555|\uFA7A \u5599|\uFA7B \u55E2|\uFA7C \u585A|\uFA7D \u58B3|\uFA7E \u5944|\uFA7F \u5954|\uFA80 \u5A62|\uFA81 \u5B28|\uFA82 \u5ED2|\uFA83 \u5ED9|\uFA84 \u5F69|\uFA85 \u5FAD|\uFA86 \u60D8|\uFA87 \u614E|\uFA88 \u6108|\uFA89 \u618E|\uFA8A \u6160|\uFA8B \u61F2|\uFA8C \u6234|\uFA8D \u63C4|\uFA8E \u641C|\uFA8F \u6452|\uFA90 \u6556|\uFA91 \u6674|\uFA92 \u6717|\uFA93 \u671B|\uFA94 \u6756|\uFA95 \u6B79|\uFA96 \u6BBA|\uFA97 \u6D41|\uFA98 \u6EDB|\uFA99 \u6ECB|\uFA9A \u6F22|\uFA9B \u701E|\uFA9C \u716E|\uFA9D \u77A7|\uFA9E \u7235|\uFA9F \u72AF|\uFAA0 \u732A|\uFAA1 \u7471|\uFAA2 \u7506|\uFAA3 \u753B|\uFAA4 \u761D|\uFAA5 \u761F|\uFAA6 \u76CA|\uFAA7 \u76DB|\uFAA8 \u76F4|\uFAA9 \u774A|\uFAAA \u7740|\uFAAB \u78CC|\uFAAC \u7AB1|\uFAAD \u7BC0|\uFAAE \u7C7B|\uFAAF \u7D5B|\uFAB0 \u7DF4|\uFAB1 \u7F3E|\uFAB2 \u8005|\uFAB3 \u8352|\uFAB4 \u83EF|\uFAB5 \u8779|\uFAB6 \u8941|\uFAB7 \u8986|\uFAB8 \u8996|\uFAB9 \u8ABF|\uFABA \u8AF8|\uFABB \u8ACB|\uFABC \u8B01|\uFABD \u8AFE|\uFABE \u8AED|\uFABF \u8B39|\uFAC0 \u8B8A|\uFAC1 \u8D08|\uFAC2 \u8F38|\uFAC3 \u9072|\uFAC4 \u9199|\uFAC5 \u9276|\uFAC6 \u967C|\uFAC7 \u96E3|\uFAC8 \u9756|\uFAC9 \u97DB|\uFACA \u97FF|\uFACB \u980B|\uFACC \u983B|\uFACD \u9B12|\uFACE \u9F9C|\uFACF \u{2284A}|\uFAD0 \u{22844}|\uFAD1 \u{233D5}|\uFAD2 \u3B9D|\uFAD3 \u4018|\uFAD4 \u4039|\uFAD5 \u{25249}|\uFAD6 \u{25CD0}|\uFAD7 \u{27ED3}|\uFAD8 \u9F43|\uFAD9 \u9F8E|\u{2F800} \u4E3D|\u{2F801} \u4E38|\u{2F802} \u4E41|\u{2F803} \u{20122}|\u{2F804} \u4F60|\u{2F805} \u4FAE|\u{2F806} \u4FBB|\u{2F807} \u5002|\u{2F808} \u507A|\u{2F809} \u5099|\u{2F80A} \u50E7|\u{2F80B} \u50CF|\u{2F80C} \u349E|\u{2F80D} \u{2063A}|\u{2F80E} \u514D|\u{2F80F} \u5154|\u{2F810} \u5164|\u{2F811} \u5177|\u{2F812} \u{2051C}|\u{2F813} \u34B9|\u{2F814} \u5167|\u{2F815} \u518D|\u{2F816} \u{2054B}|\u{2F817} \u5197|\u{2F818} \u51A4|\u{2F819} \u4ECC|\u{2F81A} \u51AC|\u{2F81B} \u51B5|\u{2F81C} \u{291DF}|\u{2F81D} \u51F5|\u{2F81E} \u5203|\u{2F81F} \u34DF|\u{2F820} \u523B|\u{2F821} \u5246|\u{2F822} \u5272|\u{2F823} \u5277|\u{2F824} \u3515|\u{2F825} \u52C7|\u{2F826} \u52C9|\u{2F827} \u52E4|\u{2F828} \u52FA|\u{2F829} \u5305|\u{2F82A} \u5306|\u{2F82B} \u5317|\u{2F82C} \u5349|\u{2F82D} \u5351|\u{2F82E} \u535A|\u{2F82F} \u5373|\u{2F830} \u537D|\u{2F831} \u537F|\u{2F832} \u537F|\u{2F833} \u537F|\u{2F834} \u{20A2C}|\u{2F835} \u7070|\u{2F836} \u53CA|\u{2F837} \u53DF|\u{2F838} \u{20B63}|\u{2F839} \u53EB|\u{2F83A} \u53F1|\u{2F83B} \u5406|\u{2F83C} \u549E|\u{2F83D} \u5438|\u{2F83E} \u5448|\u{2F83F} \u5468|\u{2F840} \u54A2|\u{2F841} \u54F6|\u{2F842} \u5510|\u{2F843} \u5553|\u{2F844} \u5563|\u{2F845} \u5584|\u{2F846} \u5584|\u{2F847} \u5599|\u{2F848} \u55AB|\u{2F849} \u55B3|\u{2F84A} \u55C2|\u{2F84B} \u5716|\u{2F84C} \u5606|\u{2F84D} \u5717|\u{2F84E} \u5651|\u{2F84F} \u5674|\u{2F850} \u5207|\u{2F851} \u58EE|\u{2F852} \u57CE|\u{2F853} \u57F4|\u{2F854} \u580D|\u{2F855} \u578B|\u{2F856} \u5832|\u{2F857} \u5831|\u{2F858} \u58AC|\u{2F859} \u{214E4}|\u{2F85A} \u58F2|\u{2F85B} \u58F7|\u{2F85C} \u5906|\u{2F85D} \u591A|\u{2F85E} \u5922|\u{2F85F} \u5962|\u{2F860} \u{216A8}|\u{2F861} \u{216EA}|\u{2F862} \u59EC|\u{2F863} \u5A1B|\u{2F864} \u5A27|\u{2F865} \u59D8|\u{2F866} \u5A66|\u{2F867} \u36EE|\u{2F868} \u36FC|\u{2F869} \u5B08|\u{2F86A} \u5B3E|\u{2F86B} \u5B3E|\u{2F86C} \u{219C8}|\u{2F86D} \u5BC3|\u{2F86E} \u5BD8|\u{2F86F} \u5BE7|\u{2F870} \u5BF3|\u{2F871} \u{21B18}|\u{2F872} \u5BFF|\u{2F873} \u5C06|\u{2F874} \u5F53|\u{2F875} \u5C22|\u{2F876} \u3781|\u{2F877} \u5C60|\u{2F878} \u5C6E|\u{2F879} \u5CC0|\u{2F87A} \u5C8D|\u{2F87B} \u{21DE4}|\u{2F87C} \u5D43|\u{2F87D} \u{21DE6}|\u{2F87E} \u5D6E|\u{2F87F} \u5D6B|\u{2F880} \u5D7C|\u{2F881} \u5DE1|\u{2F882} \u5DE2|\u{2F883} \u382F|\u{2F884} \u5DFD|\u{2F885} \u5E28|\u{2F886} \u5E3D|\u{2F887} \u5E69|\u{2F888} \u3862|\u{2F889} \u{22183}|\u{2F88A} \u387C|\u{2F88B} \u5EB0|\u{2F88C} \u5EB3|\u{2F88D} \u5EB6|\u{2F88E} \u5ECA|\u{2F88F} \u{2A392}|\u{2F890} \u5EFE|\u{2F891} \u{22331}|\u{2F892} \u{22331}|\u{2F893} \u8201|\u{2F894} \u5F22|\u{2F895} \u5F22|\u{2F896} \u38C7|\u{2F897} \u{232B8}|\u{2F898} \u{261DA}|\u{2F899} \u5F62|\u{2F89A} \u5F6B|\u{2F89B} \u38E3|\u{2F89C} \u5F9A|\u{2F89D} \u5FCD|\u{2F89E} \u5FD7|\u{2F89F} \u5FF9|\u{2F8A0} \u6081|\u{2F8A1} \u393A|\u{2F8A2} \u391C|\u{2F8A3} \u6094|\u{2F8A4} \u{226D4}|\u{2F8A5} \u60C7|\u{2F8A6} \u6148|\u{2F8A7} \u614C|\u{2F8A8} \u614E|\u{2F8A9} \u614C|\u{2F8AA} \u617A|\u{2F8AB} \u618E|\u{2F8AC} \u61B2|\u{2F8AD} \u61A4|\u{2F8AE} \u61AF|\u{2F8AF} \u61DE|\u{2F8B0} \u61F2|\u{2F8B1} \u61F6|\u{2F8B2} \u6210|\u{2F8B3} \u621B|\u{2F8B4} \u625D|\u{2F8B5} \u62B1|\u{2F8B6} \u62D4|\u{2F8B7} \u6350|\u{2F8B8} \u{22B0C}|\u{2F8B9} \u633D|\u{2F8BA} \u62FC|\u{2F8BB} \u6368|\u{2F8BC} \u6383|\u{2F8BD} \u63E4|\u{2F8BE} \u{22BF1}|\u{2F8BF} \u6422|\u{2F8C0} \u63C5|\u{2F8C1} \u63A9|\u{2F8C2} \u3A2E|\u{2F8C3} \u6469|\u{2F8C4} \u647E|\u{2F8C5} \u649D|\u{2F8C6} \u6477|\u{2F8C7} \u3A6C|\u{2F8C8} \u654F|\u{2F8C9} \u656C|\u{2F8CA} \u{2300A}|\u{2F8CB} \u65E3|\u{2F8CC} \u66F8|\u{2F8CD} \u6649|\u{2F8CE} \u3B19|\u{2F8CF} \u6691|\u{2F8D0} \u3B08|\u{2F8D1} \u3AE4|\u{2F8D2} \u5192|\u{2F8D3} \u5195|\u{2F8D4} \u6700|\u{2F8D5} \u669C|\u{2F8D6} \u80AD|\u{2F8D7} \u43D9|\u{2F8D8} \u6717|\u{2F8D9} \u671B|\u{2F8DA} \u6721|\u{2F8DB} \u675E|\u{2F8DC} \u6753|\u{2F8DD} \u{233C3}|\u{2F8DE} \u3B49|\u{2F8DF} \u67FA|\u{2F8E0} \u6785|\u{2F8E1} \u6852|\u{2F8E2} \u6885|\u{2F8E3} \u{2346D}|\u{2F8E4} \u688E|\u{2F8E5} \u681F|\u{2F8E6} \u6914|\u{2F8E7} \u3B9D|\u{2F8E8} \u6942|\u{2F8E9} \u69A3|\u{2F8EA} \u69EA|\u{2F8EB} \u6AA8|\u{2F8EC} \u{236A3}|\u{2F8ED} \u6ADB|\u{2F8EE} \u3C18|\u{2F8EF} \u6B21|\u{2F8F0} \u{238A7}|\u{2F8F1} \u6B54|\u{2F8F2} \u3C4E|\u{2F8F3} \u6B72|\u{2F8F4} \u6B9F|\u{2F8F5} \u6BBA|\u{2F8F6} \u6BBB|\u{2F8F7} \u{23A8D}|\u{2F8F8} \u{21D0B}|\u{2F8F9} \u{23AFA}|\u{2F8FA} \u6C4E|\u{2F8FB} \u{23CBC}|\u{2F8FC} \u6CBF|\u{2F8FD} \u6CCD|\u{2F8FE} \u6C67|\u{2F8FF} \u6D16|\u{2F900} \u6D3E|\u{2F901} \u6D77|\u{2F902} \u6D41|\u{2F903} \u6D69|\u{2F904} \u6D78|\u{2F905} \u6D85|\u{2F906} \u{23D1E}|\u{2F907} \u6D34|\u{2F908} \u6E2F|\u{2F909} \u6E6E|\u{2F90A} \u3D33|\u{2F90B} \u6ECB|\u{2F90C} \u6EC7|\u{2F90D} \u{23ED1}|\u{2F90E} \u6DF9|\u{2F90F} \u6F6E|\u{2F910} \u{23F5E}|\u{2F911} \u{23F8E}|\u{2F912} \u6FC6|\u{2F913} \u7039|\u{2F914} \u701E|\u{2F915} \u701B|\u{2F916} \u3D96|\u{2F917} \u704A|\u{2F918} \u707D|\u{2F919} \u7077|\u{2F91A} \u70AD|\u{2F91B} \u{20525}|\u{2F91C} \u7145|\u{2F91D} \u{24263}|\u{2F91E} \u719C|\u{2F91F} \u{243AB}|\u{2F920} \u7228|\u{2F921} \u7235|\u{2F922} \u7250|\u{2F923} \u{24608}|\u{2F924} \u7280|\u{2F925} \u7295|\u{2F926} \u{24735}|\u{2F927} \u{24814}|\u{2F928} \u737A|\u{2F929} \u738B|\u{2F92A} \u3EAC|\u{2F92B} \u73A5|\u{2F92C} \u3EB8|\u{2F92D} \u3EB8|\u{2F92E} \u7447|\u{2F92F} \u745C|\u{2F930} \u7471|\u{2F931} \u7485|\u{2F932} \u74CA|\u{2F933} \u3F1B|\u{2F934} \u7524|\u{2F935} \u{24C36}|\u{2F936} \u753E|\u{2F937} \u{24C92}|\u{2F938} \u7570|\u{2F939} \u{2219F}|\u{2F93A} \u7610|\u{2F93B} \u{24FA1}|\u{2F93C} \u{24FB8}|\u{2F93D} \u{25044}|\u{2F93E} \u3FFC|\u{2F93F} \u4008|\u{2F940} \u76F4|\u{2F941} \u{250F3}|\u{2F942} \u{250F2}|\u{2F943} \u{25119}|\u{2F944} \u{25133}|\u{2F945} \u771E|\u{2F946} \u771F|\u{2F947} \u771F|\u{2F948} \u774A|\u{2F949} \u4039|\u{2F94A} \u778B|\u{2F94B} \u4046|\u{2F94C} \u4096|\u{2F94D} \u{2541D}|\u{2F94E} \u784E|\u{2F94F} \u788C|\u{2F950} \u78CC|\u{2F951} \u40E3|\u{2F952} \u{25626}|\u{2F953} \u7956|\u{2F954} \u{2569A}|\u{2F955} \u{256C5}|\u{2F956} \u798F|\u{2F957} \u79EB|\u{2F958} \u412F|\u{2F959} \u7A40|\u{2F95A} \u7A4A|\u{2F95B} \u7A4F|\u{2F95C} \u{2597C}|\u{2F95D} \u{25AA7}|\u{2F95E} \u{25AA7}|\u{2F95F} \u7AEE|\u{2F960} \u4202|\u{2F961} \u{25BAB}|\u{2F962} \u7BC6|\u{2F963} \u7BC9|\u{2F964} \u4227|\u{2F965} \u{25C80}|\u{2F966} \u7CD2|\u{2F967} \u42A0|\u{2F968} \u7CE8|\u{2F969} \u7CE3|\u{2F96A} \u7D00|\u{2F96B} \u{25F86}|\u{2F96C} \u7D63|\u{2F96D} \u4301|\u{2F96E} \u7DC7|\u{2F96F} \u7E02|\u{2F970} \u7E45|\u{2F971} \u4334|\u{2F972} \u{26228}|\u{2F973} \u{26247}|\u{2F974} \u4359|\u{2F975} \u{262D9}|\u{2F976} \u7F7A|\u{2F977} \u{2633E}|\u{2F978} \u7F95|\u{2F979} \u7FFA|\u{2F97A} \u8005|\u{2F97B} \u{264DA}|\u{2F97C} \u{26523}|\u{2F97D} \u8060|\u{2F97E} \u{265A8}|\u{2F97F} \u8070|\u{2F980} \u{2335F}|\u{2F981} \u43D5|\u{2F982} \u80B2|\u{2F983} \u8103|\u{2F984} \u440B|\u{2F985} \u813E|\u{2F986} \u5AB5|\u{2F987} \u{267A7}|\u{2F988} \u{267B5}|\u{2F989} \u{23393}|\u{2F98A} \u{2339C}|\u{2F98B} \u8201|\u{2F98C} \u8204|\u{2F98D} \u8F9E|\u{2F98E} \u446B|\u{2F98F} \u8291|\u{2F990} \u828B|\u{2F991} \u829D|\u{2F992} \u52B3|\u{2F993} \u82B1|\u{2F994} \u82B3|\u{2F995} \u82BD|\u{2F996} \u82E6|\u{2F997} \u{26B3C}|\u{2F998} \u82E5|\u{2F999} \u831D|\u{2F99A} \u8363|\u{2F99B} \u83AD|\u{2F99C} \u8323|\u{2F99D} \u83BD|\u{2F99E} \u83E7|\u{2F99F} \u8457|\u{2F9A0} \u8353|\u{2F9A1} \u83CA|\u{2F9A2} \u83CC|\u{2F9A3} \u83DC|\u{2F9A4} \u{26C36}|\u{2F9A5} \u{26D6B}|\u{2F9A6} \u{26CD5}|\u{2F9A7} \u452B|\u{2F9A8} \u84F1|\u{2F9A9} \u84F3|\u{2F9AA} \u8516|\u{2F9AB} \u{273CA}|\u{2F9AC} \u8564|\u{2F9AD} \u{26F2C}|\u{2F9AE} \u455D|\u{2F9AF} \u4561|\u{2F9B0} \u{26FB1}|\u{2F9B1} \u{270D2}|\u{2F9B2} \u456B|\u{2F9B3} \u8650|\u{2F9B4} \u865C|\u{2F9B5} \u8667|\u{2F9B6} \u8669|\u{2F9B7} \u86A9|\u{2F9B8} \u8688|\u{2F9B9} \u870E|\u{2F9BA} \u86E2|\u{2F9BB} \u8779|\u{2F9BC} \u8728|\u{2F9BD} \u876B|\u{2F9BE} \u8786|\u{2F9BF} \u45D7|\u{2F9C0} \u87E1|\u{2F9C1} \u8801|\u{2F9C2} \u45F9|\u{2F9C3} \u8860|\u{2F9C4} \u8863|\u{2F9C5} \u{27667}|\u{2F9C6} \u88D7|\u{2F9C7} \u88DE|\u{2F9C8} \u4635|\u{2F9C9} \u88FA|\u{2F9CA} \u34BB|\u{2F9CB} \u{278AE}|\u{2F9CC} \u{27966}|\u{2F9CD} \u46BE|\u{2F9CE} \u46C7|\u{2F9CF} \u8AA0|\u{2F9D0} \u8AED|\u{2F9D1} \u8B8A|\u{2F9D2} \u8C55|\u{2F9D3} \u{27CA8}|\u{2F9D4} \u8CAB|\u{2F9D5} \u8CC1|\u{2F9D6} \u8D1B|\u{2F9D7} \u8D77|\u{2F9D8} \u{27F2F}|\u{2F9D9} \u{20804}|\u{2F9DA} \u8DCB|\u{2F9DB} \u8DBC|\u{2F9DC} \u8DF0|\u{2F9DD} \u{208DE}|\u{2F9DE} \u8ED4|\u{2F9DF} \u8F38|\u{2F9E0} \u{285D2}|\u{2F9E1} \u{285ED}|\u{2F9E2} \u9094|\u{2F9E3} \u90F1|\u{2F9E4} \u9111|\u{2F9E5} \u{2872E}|\u{2F9E6} \u911B|\u{2F9E7} \u9238|\u{2F9E8} \u92D7|\u{2F9E9} \u92D8|\u{2F9EA} \u927C|\u{2F9EB} \u93F9|\u{2F9EC} \u9415|\u{2F9ED} \u{28BFA}|\u{2F9EE} \u958B|\u{2F9EF} \u4995|\u{2F9F0} \u95B7|\u{2F9F1} \u{28D77}|\u{2F9F2} \u49E6|\u{2F9F3} \u96C3|\u{2F9F4} \u5DB2|\u{2F9F5} \u9723|\u{2F9F6} \u{29145}|\u{2F9F7} \u{2921A}|\u{2F9F8} \u4A6E|\u{2F9F9} \u4A76|\u{2F9FA} \u97E0|\u{2F9FB} \u{2940A}|\u{2F9FC} \u4AB2|\u{2F9FD} \u{29496}|\u{2F9FE} \u980B|\u{2F9FF} \u980B|\u{2FA00} \u9829|\u{2FA01} \u{295B6}|\u{2FA02} \u98E2|\u{2FA03} \u4B33|\u{2FA04} \u9929|\u{2FA05} \u99A7|\u{2FA06} \u99C2|\u{2FA07} \u99FE|\u{2FA08} \u4BCE|\u{2FA09} \u{29B30}|\u{2FA0A} \u9B12|\u{2FA0B} \u9C40|\u{2FA0C} \u9CFD|\u{2FA0D} \u4CCE|\u{2FA0E} \u4CED|\u{2FA0F} \u9D67|\u{2FA10} \u{2A0CE}|\u{2FA11} \u4CF8|\u{2FA12} \u{2A105}|\u{2FA13} \u{2A20E}|\u{2FA14} \u{2A291}|\u{2FA15} \u9EBB|\u{2FA16} \u4D56|\u{2FA17} \u9EF9|\u{2FA18} \u9EFE|\u{2FA19} \u9F05|\u{2FA1A} \u9F0F|\u{2FA1B} \u9F16|\u{2FA1C} \u9F3B|\u{2FA1D} \u{2A600}";
var A = { hk: [[u, g]], hkp: [[f, u, g]], tw: [[d, h]], twp: [[p, d, h]], jp: [["\u4E00\u7372\u5343\u91D1 \u4E00\u652B\u5343\u91D1|\u4E01\u5BE7 \u53EE\u5680|\u4E01\u91CD \u912D\u91CD|\u4E09\u5DEE\u8DEF \u4E09\u53C9\u8DEF|\u4E16\u8AD6 \u8F3F\u8AD6|\u4E88\u5099 \u9810\u5099|\u4E88\u544A \u9810\u544A|\u4E88\u5B9A \u9810\u5B9A|\u4E88\u611F \u9810\u611F|\u4E88\u6E2C \u9810\u6E2C|\u4E88\u7B97 \u9810\u7B97|\u4E88\u7D04 \u9810\u7D04|\u4E88\u7FD2 \u9810\u7FD2|\u4E88\u8A00 \u9810\u8A00|\u4E88\u9632 \u9810\u9632|\u4E9C\u9234 \u555E\u9234|\u4EA4\u5DEE \u4EA4\u53C9|\u4EE3\u5F01 \u4EE3\u8FAF|\u4F9B\u5BB4 \u9957\u5BB4|\u4FCA\u99AC \u99FF\u99AC|\u4FDD\u5841 \u5821\u58D8|\u500B\u6761\u66F8 \u7B87\u6761\u66F8|\u504F\u5E73 \u6241\u5E73|\u505C\u6CCA \u7887\u6CCA|\u512A\u4FCA \u512A\u99FF|\u5148\u5175 \u5C16\u5175|\u5148\u7AEF \u5C16\u7AEF|\u5148\u92ED \u5C16\u92B3|\u5171\u5F79 \u5171\u8EDB|\u5197\u820C \u9952\u820C|\u51F6\u5668 \u5147\u5668|\u524A\u5CA9 \u947F\u5CA9|\u5305\u4E01 \u5E96\u4E01|\u5305\u5E2F \u7E43\u5E36|\u533A\u753B \u5340\u5283|\u53B3\u7136 \u513C\u7136|\u53CB\u5B9C \u53CB\u8ABC|\u53CD\u4E71 \u53DB\u4E82|\u53CE\u96C6 \u8490\u96C6|\u53D9\u60C5 \u6292\u60C5|\u53F0\u982D \u64E1\u982D|\u5408\u5F01 \u5408\u8FA6|\u559C\u904A\u66F2 \u5B09\u904A\u66F2|\u5606\u9858 \u6B4E\u9858|\u56DE\u8EE2 \u5EFB\u8EE2|\u56DE\u904A \u56DE\u6E38|\u56FD\u969B\u9023\u76DF \u570B\u969B\u806F\u76DF|\u5949\u6301 \u6367\u6301|\u59D4\u7E2E \u840E\u7E2E|\u5B89\u5168\u5F01 \u5B89\u5168\u74E3|\u5C55\u8EE2 \u8F3E\u8F49|\u5E0C\u5C11 \u7A00\u5C11|\u5E7B\u60D1 \u7729\u60D1|\u5E83\u7BC4 \u5EE3\u6CDB|\u5E83\u91CE \u66E0\u91CE|\u5EC3\u865A \u5EE2\u589F|\u5EFA\u576A\u7387 \u5EFA\u853D\u7387|\u5F01\u5225 \u8FA8\u5225|\u5F01\u5F53 \u8FA8\u7576|\u5F01\u624D \u8FAF\u624D|\u5F01\u660E \u8FAF\u660E|\u5F01\u819C \u74E3\u819C|\u5F01\u89E3 \u8FAF\u89E3|\u5F01\u8A3C \u8FAF\u8B49|\u5F01\u8AD6 \u8FAF\u8AD6|\u5F01\u8AD6\u5BB6 \u8FAF\u8AD6\u5BB6|\u5F01\u8B77 \u8FAF\u8B77|\u5F01\u8B77\u58EB \u8FAF\u8B77\u58EB|\u5F01\u8CA1\u5929 \u8FAF\u8CA1\u5929|\u5F01\u99C1 \u8FAF\u99C1|\u5F01\u9AEA \u8FAE\u9AEE|\u5F26\u6B4C \u7D43\u6B4C|\u6069\u7FA9 \u6069\u8ABC|\u610F\u5411 \u610F\u56AE|\u6170\u8B1D\u6599 \u6170\u85C9\u6599|\u61B6\u65AD \u81C6\u65B7|\u61B6\u75C5 \u81C6\u75C5|\u6226\u6CA1 \u6230\u6B7F|\u6247\u60C5 \u717D\u60C5|\u624B\u5E33 \u624B\u5E16|\u6280\u91CF \u4F0E\u5006|\u629C\u7C8B \u629C\u8403|\u62AB\u6B74 \u62AB\u701D|\u62B5\u89E6 \u7274\u89F8|\u62BD\u9078 \u62BD\u7C64|\u62D8\u5F15 \u52FE\u5F15|\u62E0\u51FA \u91B5\u51FA|\u62E0\u91D1 \u91B5\u91D1|\u6398\u524A \u6398\u947F|\u63A7\u9664 \u6263\u9664|\u63F4\u8B77 \u63A9\u8B77|\u653E\u68C4 \u629B\u68C4|\u6563\u6C34 \u6492\u6C34|\u656C\u8B19 \u656C\u8654|\u6577\u5EF6 \u6577\u884D|\u65AD\u56FA \u65B7\u4E4E|\u65CF\u751F \u7C07\u751F|\u6607\u53D9 \u965E\u6558|\u6696\u623F \u7156\u623F|\u6697\u5531 \u6697\u8AA6|\u6697\u591C \u95C7\u591C|\u66B4\u9732 \u66DD\u9732|\u67AF\u6E07 \u6DB8\u6E34|\u683C\u597D \u6070\u597D|\u683C\u5E45 \u6070\u5E45|\u68C4\u640D \u6BC0\u640D|\u6A21\u7D22 \u6478\u7D22|\u6A4B\u982D\u4FDD \u6A4B\u982D\u5821|\u6B20\u7F3A \u6B20\u7F3A|\u6B27\u5DDE \u6B50\u6D32|\u6B27\u5DDE\u9023\u5408 \u6B50\u6D32\u806F\u76DF|\u6B7B\u4F53 \u5C4D\u9AD4|\u6BBF\u90E8 \u81C0\u90E8|\u6BCD\u6307 \u62C7\u6307|\u6C17\u8FEB \u6C23\u9B44|\u6C7A\u5225 \u8A23\u5225|\u6C7A\u58CA \u6C7A\u6F70|\u6C88\u6BBF \u6C88\u6FB1|\u6CB9\u9001\u8239 \u6CB9\u69FD\u8239|\u6CE2\u4E71 \u6CE2\u703E|\u6CE8\u91C8 \u8A3B\u91CB|\u6D17\u6D44 \u6D17\u6ECC|\u6D3B\u767A \u6D3B\u6F51|\u6D78\u900F \u6EF2\u900F|\u6D78\u98DF \u6D78\u8755|\u6D88\u5374 \u92B7\u537B|\u6DF7\u7136 \u6E3E\u7136|\u6E7E\u66F2 \u5F4E\u66F2|\u6EB6\u63A5 \u7194\u63A5|\u6F01\u52B4 \u6F01\u6488|\u6F02\u7136 \u98C4\u7136|\u6FC0\u9AD8 \u6FC0\u6602|\u706B\u708E \u706B\u7130|\u7126\u71E5 \u7126\u8E81|\u7336\u4E88 \u7336\u8C6B|\u73ED\u70B9 \u6591\u9EDE|\u7559\u98F2 \u6E9C\u98F2|\u7565\u596A \u63A0\u596A|\u758E\u901A \u758F\u901A|\u767A\u9175 \u91B1\u9175|\u767D\u4E9C \u767D\u580A|\u76F8\u514B \u76F8\u524B|\u77E5\u6075 \u667A\u6167|\u7834\u68C4 \u7834\u6BC0|\u78BA\u56FA \u78BA\u4E4E|\u7981\u56FA \u7981\u932E|\u7B26\u4E01 \u7B26\u7252|\u7C89\u88C5 \u626E\u88DD|\u7D2B\u73ED \u7D2B\u6591|\u7D42\u606F \u7D42\u7184|\u7DCF\u5408 \u7D9C\u5408|\u7DE8\u96C6 \u7DE8\u8F2F|\u7FA9\u63F4 \u7FA9\u6350|\u8015\u904B\u6A5F \u8015\u8018\u6A5F|\u809D\u5FC3 \u809D\u814E|\u80A9\u7532\u9AA8 \u80A9\u80DB\u9AA8|\u80CC\u5FB3 \u6096\u5FB7|\u8108\u62CD \u8108\u640F|\u81A8\u5F35 \u81A8\u8139|\u82B1\u5F01 \u82B1\u74E3|\u82B3\u7D14 \u82B3\u9187|\u82F1\u77E5 \u53E1\u667A|\u84B8\u7559 \u84B8\u6E9C|\u85AB\u84B8 \u71FB\u84B8|\u85AB\u88FD \u71FB\u88FD|\u8863\u88C5 \u8863\u88F3|\u8870\u9000 \u8870\u9000|\u88D5\u7136 \u60A0\u7136|\u88DC\u4F50 \u8F14\u4F50|\u8A13\u6212 \u8A13\u8AA1|\u8A66\u7DF4 \u8A66\u7149|\u8A6D\u5F01 \u8A6D\u8FAF|\u8B1B\u548C \u5ABE\u548C|\u8C61\u773C \u8C61\u5D4C|\u8CAB\u9332 \u8CAB\u797F|\u8CB7\u5F01 \u8CB7\u8FA6|\u8CDB\u8F9E \u8B9A\u8FAD|\u8E0F\u8972 \u8E48\u8972|\u8ECA\u4E21 \u8ECA\u8F1B|\u8EE2\u5012 \u985B\u5012|\u8F2A\u90ED \u8F2A\u5ED3|\u9000\u8272 \u892A\u8272|\u9014\u7D76 \u675C\u7D55|\u9023\u4FC2 \u9023\u7E6B|\u9023\u5408 \u806F\u5408|\u9023\u5408\u4F1A \u806F\u5408\u6703|\u9023\u5408\u56FD \u806F\u5408\u570B|\u9023\u5408\u8266\u968A \u806F\u5408\u8266\u968A|\u9023\u5408\u8ECD \u806F\u5408\u8ECD|\u9023\u540D \u806F\u540D|\u9023\u60F3 \u806F\u60F3|\u9023\u643A \u806F\u651C|\u9023\u76DF \u806F\u76DF|\u9023\u7ACB \u806F\u7ACB|\u9023\u7D50 \u806F\u7D50|\u9023\u7D50\u5668 \u806F\u7D50\u5668|\u9023\u7D50\u6027 \u806F\u7D50\u6027|\u9023\u7D61 \u806F\u7D61|\u9023\u7D61\u54E1 \u806F\u7D61\u54E1|\u9023\u7D61\u7DB2 \u806F\u7D61\u7DB2|\u9023\u7D61\u7DDA \u806F\u7D61\u7DDA|\u9023\u7D61\u8239 \u806F\u7D61\u8239|\u9023\u90A6 \u806F\u90A6|\u9023\u90A6\u5171\u548C\u56FD \u806F\u90A6\u5171\u548C\u570B|\u9023\u90A6\u5236 \u806F\u90A6\u5236|\u9023\u90A6\u56FD \u806F\u90A6\u570B|\u9023\u90A6\u56FD\u5BB6 \u806F\u90A6\u570B\u5BB6|\u9023\u90A6\u653F\u5E9C \u806F\u90A6\u653F\u5E9C|\u9023\u90A6\u8B70\u4F1A \u806F\u90A6\u8B70\u6703|\u9023\u90A6\u8ECD \u806F\u90A6\u8ECD|\u9023\u968A \u806F\u968A|\u9078\u8003 \u9293\u8861|\u9162\u9178 \u918B\u9178|\u91CE\u5351 \u91CE\u9119|\u9271\u77F3 \u7926\u77F3|\u9593\u6B20 \u9593\u6B47|\u95A2\u6570 \u51FD\u6578|\u95A2\u9023 \u95DC\u806F|\u95A2\u9023\u56F3 \u95DC\u806F\u5716|\u95A2\u9023\u6027 \u95DC\u806F\u6027|\u95A2\u9023\u8A9E \u95DC\u806F\u8A9E|\u9632\u5FA1 \u9632\u79A6|\u967A\u963B \u5DAE\u5CA8|\u969C\u58C1 \u7246\u58C1|\u969C\u5BB3 \u969C\u7919|\u96A0\u6EC5 \u6E6E\u6EC5|\u96C4\u5F01 \u96C4\u8FAF|\u96C6\u843D \u805A\u843D|\u96C7\u7528 \u50F1\u50AD|\u98A8\u8AED \u8AF7\u55A9|\u98DB\u8A9E \u871A\u8A9E|\u9999\u5178 \u9999\u5960|\u9AA8\u683C \u9AA8\u9ABC|\u9AD8\u9032 \u4EA2\u9032|\u9CE5\u89B3 \u9CE5\u77B0", "\u4E07 \u842C|\u4E0E \u8207|\u4E21 \u5169|\u4E26 \u7ADD|\u4E57 \u4E58|\u4E71 \u4E82|\u4E80 \u9F9C|\u4E88 \u8C6B|\u4E89 \u722D|\u4E98 \u4E99|\u4E9C \u4E9E|\u4ECF \u4F5B|\u4EEE \u5047|\u4F1A \u6703|\u4F1D \u50B3|\u4F53 \u9AD4|\u4F59 \u9918|\u4F75 \u5002|\u4FA1 \u50F9|\u5039 \u5109|\u507D \u50DE|\u5150 \u5152|\u515A \u9EE8|\u5186 \u5713|\u5199 \u5BEB|\u51DC \u51DB|\u51E6 \u8655|\u5263 \u528D|\u5264 \u5291|\u5270 \u5269|\u52B1 \u52F5|\u52B4 \u52DE|\u52B9 \u6548|\u52C5 \u6555|\u52E7 \u52F8|\u52F2 \u52F3|\u533A \u5340|\u533B \u91AB|\u5358 \u55AE|\u5373 \u537D|\u53B3 \u56B4|\u53C2 \u53C3|\u53CC \u96D9|\u53CE \u6536|\u53D9 \u654D|\u53F0 \u81FA|\u53F7 \u865F|\u5516 \u555E|\u55B6 \u71DF|\u5631 \u56D1|\u565B \u5699|\u56E3 \u5718|\u56F2 \u570D|\u56F3 \u5716|\u56FD \u570B|\u570F \u5708|\u5727 \u58D3|\u5815 \u58AE|\u5841 \u58D8|\u5869 \u9E7D|\u5897 \u589E|\u58CA \u58DE|\u58CC \u58E4|\u58EE \u58EF|\u58F0 \u8072|\u58F1 \u58F9|\u58F2 \u8CE3|\u5909 \u8B8A|\u5965 \u5967|\u5968 \u596C|\u5B22 \u5B43|\u5B66 \u5B78|\u5B9D \u5BF6|\u5B9F \u5BE6|\u5BDB \u5BEC|\u5BDD \u5BE2|\u5BFE \u5C0D|\u5BFF \u58FD|\u5C02 \u5C08|\u5C06 \u5C07|\u5C2D \u582F|\u5C3D \u76E1|\u5C4A \u5C46|\u5C5E \u5C6C|\u5CB3 \u5DBD|\u5CE1 \u5CFD|\u5DCC \u5DD6|\u5DE3 \u5DE2|\u5DFB \u5377|\u5E2F \u5E36|\u5E30 \u6B78|\u5E81 \u5EF3|\u5E83 \u5EE3|\u5EC3 \u5EE2|\u5F01 \u8FA8|\u5F10 \u8CB3|\u5F25 \u5F4C|\u5F2F \u5F4E|\u5F3E \u5F48|\u5F53 \u7576|\u5F84 \u5F91|\u5F93 \u5F9E|\u5FB3 \u5FB7|\u5FB4 \u5FB5|\u5FDC \u61C9|\u604B \u6200|\u6052 \u6046|\u6075 \u60E0|\u60A9 \u60F1|\u60AA \u60E1|\u60E8 \u6158|\u614E \u613C|\u61D0 \u61F7|\u6226 \u6230|\u622F \u6232|\u623B \u623E|\u6255 \u62C2|\u629C \u62D4|\u629E \u64C7|\u62C5 \u64D4|\u62DD \u62DC|\u62E0 \u64DA|\u62E1 \u64F4|\u6319 \u64E7|\u631F \u633E|\u633F \u63D2|\u635C \u641C|\u63B2 \u63ED|\u63BB \u6414|\u63FA \u6416|\u6442 \u651D|\u6483 \u64CA|\u64B9 \u652A|\u6570 \u6578|\u6589 \u9F4A|\u658E \u9F4B|\u65AD \u65B7|\u65E7 \u820A|\u663C \u665D|\u6643 \u6644|\u6669 \u665A|\u6681 \u66C9|\u66A6 \u66C6|\u66FD \u66FE|\u6761 \u689D|\u6765 \u4F86|\u67A2 \u6A1E|\u6804 \u69AE|\u685C \u6AFB|\u685D \u67A1|\u685F \u68E7|\u6867 \u6A9C|\u691C \u6AA2|\u697C \u6A13|\u697D \u6A02|\u6982 \u69EA|\u69D8 \u6A23|\u69D9 \u69C7|\u6A29 \u6B0A|\u6A2A \u6A6B|\u6B20 \u7F3A|\u6B27 \u6B50|\u6B53 \u6B61|\u6B69 \u6B65|\u6B6F \u9F52|\u6B73 \u6B72|\u6B74 \u6B77|\u6B8B \u6B98|\u6BB4 \u6BC6|\u6BBB \u6BBC|\u6BCE \u6BCF|\u6C17 \u6C23|\u6CA2 \u6FA4|\u6CAA \u6FFE|\u6D44 \u6DE8|\u6D45 \u6DFA|\u6D5C \u6FF1|\u6D99 \u6DDA|\u6E07 \u6E34|\u6E08 \u6FDF|\u6E09 \u6D89|\u6E0B \u6F81|\u6E13 \u6EAA|\u6E29 \u6EAB|\u6E7E \u7063|\u6E7F \u6FD5|\u6E80 \u6EFF|\u6EDD \u7027|\u6EDE \u6EEF|\u6F5C \u6F5B|\u702C \u7028|\u706F \u71C8|\u7089 \u7210|\u70B9 \u9EDE|\u70BA \u7232|\u713C \u71D2|\u72A0 \u72A7|\u72B6 \u72C0|\u72EC \u7368|\u72ED \u72F9|\u731F \u7375|\u732E \u737B|\u7363 \u7378|\u74F6 \u7501|\u753B \u756B|\u7573 \u758A|\u75E9 \u7626|\u75F4 \u7661|\u767A \u767C|\u76D7 \u76DC|\u770C \u7E23|\u771F \u771E|\u7814 \u784F|\u7815 \u788E|\u793C \u79AE|\u7962 \u79B0|\u7977 \u79B1|\u7984 \u797F|\u7985 \u79AA|\u79D8 \u7955|\u79F0 \u7A31|\u7A32 \u7A3B|\u7A42 \u7A57|\u7A4F \u7A69|\u7A63 \u7A70|\u7A83 \u7ACA|\u7ADC \u9F8D|\u7C8B \u7CB9|\u7C9B \u8085|\u7CF8 \u7D72|\u7D4C \u7D93|\u7D75 \u7E6A|\u7D99 \u7E7C|\u7D9A \u7E8C|\u7DCF \u7E3D|\u7DD1 \u7DA0|\u7DD2 \u7DD6|\u7E01 \u7DE3|\u7E04 \u7E69|\u7E26 \u7E31|\u7E4A \u7E96|\u7E4D \u7E61|\u7F36 \u7F50|\u7FFB \u98DC|\u8074 \u807D|\u80C6 \u81BD|\u811A \u8173|\u8131 \u812B|\u8133 \u8166|\u81D3 \u81DF|\u8276 \u8277|\u82A6 \u8606|\u82B8 \u85DD|\u830E \u8396|\u8358 \u838A|\u840C \u8420|\u848B \u8523|\u8535 \u85CF|\u85AB \u85B0|\u85AC \u85E5|\u865A \u865B|\u866B \u87F2|\u8695 \u8836|\u86CD \u87A2|\u86EE \u883B|\u874B \u881F|\u885B \u885E|\u88C5 \u88DD|\u8912 \u8943|\u8987 \u9738|\u899A \u89BA|\u89A7 \u89BD|\u89B3 \u89C0|\u89E6 \u89F8|\u8A33 \u8B6F|\u8A3C \u8B49|\u8A89 \u8B7D|\u8AAC \u8AAA|\u8AAD \u8B80|\u8B21 \u8B20|\u8B72 \u8B93|\u8C4A \u8C50|\u8CDB \u8D0A|\u8DF5 \u8E10|\u8EE2 \u8F49|\u8EFD \u8F15|\u8F9E \u8FAD|\u8FBA \u908A|\u9013 \u905E|\u9045 \u9072|\u9065 \u9059|\u90CE \u90DE|\u90F7 \u9115|\u9154 \u9189|\u91A4 \u91AC|\u91B8 \u91C0|\u91C8 \u91CB|\u9244 \u9435|\u9271 \u945B|\u92AD \u9322|\u92F3 \u9444|\u932C \u934A|\u9332 \u9304|\u93AE \u93AD|\u95A2 \u95DC|\u95B2 \u95B1|\u95D8 \u9B2D|\u9665 \u9677|\u967A \u96AA|\u968F \u96A8|\u96A0 \u96B1|\u96D1 \u96DC|\u970A \u9748|\u9759 \u975C|\u9834 \u7A4E|\u983C \u8CF4|\u9854 \u984F|\u9855 \u986F|\u9905 \u9920|\u99C5 \u9A5B|\u99C6 \u9A45|\u9A12 \u9A37|\u9A13 \u9A57|\u9AC4 \u9AD3|\u9AEA \u9AEE|\u9D0E \u9DD7|\u9D8F \u9DC4|\u9E78 \u9E7C|\u9EA6 \u9EA5|\u9EB9 \u9EB4|\u9EBA \u9EB5|\u9EC4 \u9EC3|\u9ED2 \u9ED1|\u9ED9 \u9ED8|\u9F62 \u9F61"]] };
var C = { cn: [[y, m]] };
var E = { hk2s: { normalizationChain: [[v]], segmentation: [y], conversionChain: [[u, g], [y, m]] }, hk2sp: { normalizationChain: [[v]], segmentation: [y], conversionChain: [[f, u, g], [y, m]] }, t2s: { normalizationChain: [[v]], conversionChain: [[y, m]] }, tw2s: { normalizationChain: [[v]], segmentation: [y], conversionChain: [[d, h], [y, m]] }, tw2sp: { normalizationChain: [[v]], segmentation: [y], conversionChain: [[p, d, h], [y, m]] } };
var N = Object.freeze({ __proto__: null, configs: E, from: A, to: C });
var w = (T = N, function(t2) {
  if (["from", "to"].forEach((n2) => {
    if (!t2 || "string" != typeof t2[n2]) throw new Error("Please provide the `" + n2 + "` option");
    if ("t" !== t2[n2] && !T[n2][t2[n2]]) throw new Error("Unknown `" + n2 + "` locale: " + t2[n2]);
  }), T.configs) {
    const i3 = T.configs[e2 = t2.from, r2 = t2.to, "cn" === e2 ? `s2${r2}` : "cn" === r2 ? "hkp" === e2 ? "hk2sp" : "twp" === e2 ? "tw2sp" : `${e2}2s` : `${e2}2${r2}`];
    if (i3) {
      const t3 = (function(t4, ...e4) {
        let r3 = null;
        t4 && (r3 = new n(), Array.isArray(t4) && t4.every((n2) => "string" == typeof n2) ? r3.loadDictGroup(t4) : r3.loadDict(t4));
        const o2 = e4.map((t5) => {
          const e5 = new n();
          return e5.loadDictGroup(t5), e5;
        });
        return function(n2) {
          const t5 = r3 ? r3.segment(n2) : [n2];
          return o2.reduce((n3, t6) => n3.map((n4) => t6.convert(n4)), t5).join("");
        };
      })(i3.segmentation, ...i3.conversionChain);
      if (!i3.normalizationChain) return t3;
      const e3 = o(...i3.normalizationChain);
      return function(n2) {
        return t3(e3(n2));
      };
    }
  }
  var e2, r2;
  let i2 = [];
  return ["from", "to"].forEach((n2) => {
    var e3;
    "t" !== t2[n2] && i2.push(...(e3 = T[n2][t2[n2]], Array.isArray(e3) && Array.isArray(e3[0]) ? e3 : [e3]));
  }), o.apply(null, i2);
});
var T;
var b = { Trie: n, ConverterFactory: o, Converter: w, CustomConverter: c, HTMLConverter: s, Locale: N };

// packages/nodes/classf/src/blacklist.ts
var sameaArtistInput = normalizeSameaInput({});
var toSimplifiedChinese = b.Converter({ from: "t", to: "cn" });
function parseSameaArtistLabel(keyword) {
  const source = keyword.trim();
  if (!source) return void 0;
  const artist = extractArtist(source.includes("[") ? source : `[${source}]`, sameaArtistInput);
  if (!artist) return void 0;
  const content = artist.label.replace(/^\[|\]$/g, "");
  const groupArtist = content.match(/^(.+?)\s*\(([^()]+)\)$/);
  return {
    label: artist.label,
    circle: groupArtist?.[1]?.trim() || void 0,
    artist: groupArtist?.[2]?.trim() ?? content
  };
}
function normalizeClassfBlacklistText(value) {
  return toSimplifiedChinese(value).toLocaleLowerCase();
}
function isClassfBlacklistedArtist(artist, keywords) {
  const parts = parseSameaArtistLabel(artist);
  const labels = [artist, parts?.circle && `[${parts.circle}]`, parts?.artist && `[${parts.artist}]`].filter((label) => Boolean(label)).map(normalizeClassfBlacklistText);
  const normalizedKeywords = keywords.map(normalizeClassfBlacklistText).filter(Boolean);
  return normalizedKeywords.some((keyword) => labels.some((label) => label.includes(keyword)));
}

// packages/nodes/classf/src/core.ts
var DEFAULT_CRASHU_SOURCE_PATH = "E:\\1Hub\\EH\\1EHV";
var DEFAULT_CRASHU_THRESHOLD = 0.8;
var DEFAULT_CLASSF_BLACKLIST_KEYWORDS = ["[OgoG]", "[\u3076\u305F\u30B3\u30DE300g]", "[\u3059\u3044\u305B\u3044\u3080\u3057]", "[\u30C0\u30C4\u30DE69]", "[\u30E4\u30AD\u30AB\u30EB\u30D3\u30FC]"];
function normalizeClassfInput(input) {
  const legacyQueues = legacyQueueSettings(input.classifyMode);
  const legacyGrouping = input.sameaGroupEnabled ?? false;
  return {
    action: input.action ?? "plan",
    path: clean2(input.path),
    paths: uniqueClean2([input.path, ...input.paths ?? [], ...parseList2(input.listText)]),
    listText: input.listText ?? "",
    crashuSourcePaths: uniqueClean2(input.crashuSourcePaths ?? []),
    crashuSimilarityThreshold: clamp01(input.crashuSimilarityThreshold ?? DEFAULT_CRASHU_THRESHOLD),
    targetDir: optional(input.targetDir),
    transferMode: input.transferMode ?? "move",
    classifyMode: input.classifyMode ?? "auto",
    placementMode: input.placementMode ?? "local",
    existingPolicy: input.existingPolicy ?? "merge",
    workItemMode: input.workItemMode ?? "files",
    dryRun: input.dryRun ?? true,
    alreadyEnabled: input.alreadyEnabled ?? legacyQueues.already,
    waitEnabled: input.waitEnabled ?? legacyQueues.wait,
    delEnabled: input.delEnabled ?? legacyQueues.del,
    blacklistKeywords: uniqueClean2(input.blacklistKeywords ?? DEFAULT_CLASSF_BLACKLIST_KEYWORDS),
    sameaIgnorePathBlacklist: input.sameaIgnorePathBlacklist ?? false,
    sameaMinOccurrences: clampInt2(input.sameaMinOccurrences ?? 1, 1, 100),
    sameaCentralize: input.sameaCentralize ?? false,
    sameaGroupEnabled: legacyGrouping,
    sameaGroupMinOccurrences: clampInt2(input.sameaGroupMinOccurrences ?? 1, 1, 100),
    sameaGroupCentralize: input.sameaGroupCentralize ?? false,
    sameaGroupAlreadyEnabled: input.sameaGroupAlreadyEnabled ?? legacyGrouping,
    sameaGroupWaitEnabled: input.sameaGroupWaitEnabled ?? legacyGrouping,
    sameaGroupDelEnabled: input.sameaGroupDelEnabled ?? false
  };
}
async function runClassf(input, runtime, onEvent = () => {
}) {
  const normalized = normalizeClassfInput(input);
  try {
    const sameaPaths = normalized.paths.length ? normalized.paths : await runtime.readClipboardPaths();
    if (!sameaPaths.length) return failure2("SameA found no valid archive roots in the clipboard.", normalized);
    if (normalized.placementMode === "root" && !normalized.targetDir) return failure2("Root placement requires a target directory.", normalized);
    const crashuSourcePaths = normalized.crashuSourcePaths.length ? normalized.crashuSourcePaths : [DEFAULT_CRASHU_SOURCE_PATH];
    onEvent({ type: "progress", progress: 5, message: "SameA: building the source plan.", data: { kind: "classf-stage", stage: "samea", status: "running" } });
    const sameaPlan = await runtime.runSamea({ action: "plan", paths: sameaPaths, ignorePathBlacklist: normalized.sameaIgnorePathBlacklist, minOccurrences: normalized.sameaMinOccurrences, centralize: normalized.sameaCentralize, includeDirectories: normalized.workItemMode !== "files", skipGroupedDirectories: normalized.workItemMode !== "files", dryRun: true }, (event) => forward(event, 5, 15, onEvent));
    if (!sameaPlan.success || !sameaPlan.data) return failure2(sameaPlan.message, normalized, { samea: sameaPlan.data });
    const groups = sameaPlan.data.groups.filter((group) => group.status === "ready");
    let crashuData;
    if (groups.length) {
      onEvent({ type: "progress", progress: 20, message: "CrashU: matching source folders against SameA artists.", data: { kind: "classf-stage", stage: "crashu", status: "running" } });
      const crashu = await runtime.runCrashu({ action: "scan", sourcePaths: crashuSourcePaths, targetNames: groups.map((group) => group.name), similarityThreshold: normalized.crashuSimilarityThreshold, dryRun: true }, (event) => forward(event, 20, 15, onEvent));
      if (!crashu.success || !crashu.data) return failure2(crashu.message, normalized, { samea: sameaPlan.data, crashu: crashu.data });
      crashuData = crashu.data;
    }
    const sourceItems = await collectInputItems(sameaPaths, normalized.workItemMode, runtime);
    const transfers = buildFileTransfers(sourceItems, sameaPaths, sameaPlan.data, crashuData, normalized, runtime);
    const baseDir = normalized.placementMode === "root" ? normalized.targetDir : inferInputBase(sameaPaths, runtime);
    onEvent({ type: "progress", progress: 35, message: "MigrateF: building the complete per-directory transfer plan.", data: { kind: "classf-stage", stage: "already", status: "running" } });
    const delPlan = await runTransferGroups(transfers.filter((item) => item.stage === "del"), "plan", normalized, runtime, (event) => forward(event, 35, 3, onEvent));
    const alreadyPlan = await runTransferGroups(transfers.filter((item) => item.stage === "already"), "plan", normalized, runtime, (event) => forward(event, 35, 5, onEvent));
    const waitPlan = await runTransferGroups(transfers.filter((item) => item.stage === "wait"), "plan", normalized, runtime, (event) => forward(event, 40, 5, onEvent));
    const items = transferItems([...delPlan.plan, ...alreadyPlan.plan, ...waitPlan.plan], transfers, sameaPaths, normalized, runtime);
    const plannedData = summarize2({ ...normalized, paths: sameaPaths }, items, baseDir, { samea: sameaPlan.data, crashu: crashuData, migrateDel: delPlan.data, migrateAlready: alreadyPlan.data, migrateWait: waitPlan.data });
    onEvent({ type: "progress", progress: 45, message: `ClassF plan ready: ${plannedData.readyCount} transfer(s).`, data: { kind: "classf-plan", result: plannedData } });
    if (normalized.action === "plan" || normalized.dryRun) {
      return { success: plannedData.errorCount === 0, message: `ClassF pipeline planned ${plannedData.readyCount} transfer(s).`, data: plannedData };
    }
    const completedDel = await runTransferGroups(transfers.filter((item) => item.stage === "del"), normalized.transferMode, normalized, runtime, (event) => forwardMigrate(event, 50, 15, "del", items, runtime, onEvent));
    emitCompletedItems(completedDel.data, "del", baseDir ?? "", runtime, onEvent);
    const completedAlready = await runTransferGroups(transfers.filter((item) => item.stage === "already"), normalized.transferMode, normalized, runtime, (event) => forwardMigrate(event, 65, 15, "already", items, runtime, onEvent));
    emitCompletedItems(completedAlready.data, "already", baseDir ?? "", runtime, onEvent);
    const completedWait = await runTransferGroups(transfers.filter((item) => item.stage === "wait"), normalized.transferMode, normalized, runtime, (event) => forwardMigrate(event, 80, 10, "wait", items, runtime, onEvent));
    emitCompletedItems(completedWait.data, "wait", baseDir ?? "", runtime, onEvent);
    const grouped = hasSameaGrouping(normalized) ? await runPostTransferSamea(sameaPaths, transfers, normalized, runtime, onEvent) : {};
    const completedItems = transferItems([...completedDel.plan, ...completedAlready.plan, ...completedWait.plan], transfers, sameaPaths, normalized, runtime);
    const data3 = summarize2({ ...normalized, paths: sameaPaths }, completedItems, baseDir, { samea: sameaPlan.data, crashu: crashuData, migrateDel: completedDel.data, migrateAlready: completedAlready.data, migrateWait: completedWait.data, ...grouped });
    return { success: data3.errorCount === 0, message: `ClassF pipeline applied ${data3.movedCount + data3.copiedCount} transfer(s).`, data: data3 };
  } catch (error) {
    return failure2(errorMessage2(error), normalized);
  }
}
async function runPostTransferSamea(sourcePaths, transfers, input, runtime, onEvent) {
  const roots = /* @__PURE__ */ new Map([
    ["already", /* @__PURE__ */ new Set()],
    ["wait", /* @__PURE__ */ new Set()],
    ["del", /* @__PURE__ */ new Set()]
  ]);
  if (input.placementMode === "root" && input.targetDir) {
    for (const stage of routeStages()) if (isSameaGroupEnabled(stage, input)) roots.get(stage).add(runtime.join(input.targetDir, stage));
  } else {
    for (const transfer of transfers) if (isSameaGroupEnabled(transfer.stage, input)) roots.get(transfer.stage).add(transfer.targetDir);
    const existingRoots = await findClassificationDirectories(sourcePaths, runtime);
    for (const stage of routeStages()) {
      if (isSameaGroupEnabled(stage, input)) for (const path of existingRoots.get(stage)) roots.get(stage).add(path);
    }
  }
  const output = {};
  for (const stage of routeStages()) {
    if (!isSameaGroupEnabled(stage, input)) continue;
    const paths = [];
    for (const path of roots.get(stage)) {
      const info = await runtime.pathInfo(path);
      if (info.exists && info.isDirectory) paths.push(path);
    }
    if (!paths.length) continue;
    const progress = stage === "already" ? 92 : stage === "wait" ? 95 : 98;
    onEvent({ type: "progress", progress, message: `SameA: grouping ${stage} files.` });
    const result = await runtime.runSamea({
      action: "classify",
      paths,
      ignorePathBlacklist: input.sameaIgnorePathBlacklist,
      minOccurrences: input.sameaGroupMinOccurrences,
      centralize: input.sameaGroupCentralize,
      includeDirectories: input.workItemMode !== "files",
      skipGroupedDirectories: true,
      dryRun: false
    }, (event) => forward(event, progress - 2, 2, onEvent));
    if (stage === "already") output.sameaGroupAlready = result.data;
    else if (stage === "wait") output.sameaGroupWait = result.data;
    else output.sameaGroupDel = result.data;
    if (!result.success) onEvent({ type: "log", message: `SameA ${stage} grouping failed: ${result.message}` });
  }
  onEvent({ type: "progress", progress: 100, message: "SameA grouping completed." });
  return output;
}
async function findClassificationDirectories(sourcePaths, runtime) {
  const found = /* @__PURE__ */ new Map([
    ["already", /* @__PURE__ */ new Set()],
    ["wait", /* @__PURE__ */ new Set()],
    ["del", /* @__PURE__ */ new Set()]
  ]);
  const visited = /* @__PURE__ */ new Set();
  async function visit(path) {
    const info = await runtime.pathInfo(path);
    if (!info.exists) return;
    if (info.isFile) {
      for (const stage of routeStages()) found.get(stage).add(runtime.join(runtime.dirname(info.path), stage));
      return;
    }
    if (!info.isDirectory || visited.has(normalizePath2(info.path))) return;
    const ownStage = classificationStage(runtime.basename(info.path));
    if (ownStage) {
      found.get(ownStage).add(info.path);
      return;
    }
    if (isClassificationDirectory(runtime.basename(info.path))) return;
    visited.add(normalizePath2(info.path));
    for (const entry of await runtime.listDir(info.path)) {
      if (!entry.isDirectory) continue;
      const stage = classificationStage(entry.name);
      if (stage) found.get(stage).add(entry.path);
      else if (!isClassificationDirectory(entry.name)) await visit(entry.path);
    }
  }
  for (const path of sourcePaths) await visit(path);
  return found;
}
async function collectInputItems(paths, mode, runtime) {
  const items = [];
  if (mode !== "files") {
    for (const path of paths) {
      const info = await runtime.pathInfo(path);
      if (!info.exists || !info.isDirectory) continue;
      const entries = await runtime.listDir(info.path);
      for (const entry of selectSinglePackFolderSources(entries)) {
        if (isClassificationDirectory(entry.name) || isArtistGroupDirectory2(entry.name)) continue;
        items.push({ name: entry.name, path: entry.path, isFile: false, isDirectory: true });
      }
      if (mode === "mixed") {
        for (const entry of entries) if (entry.isFile && isArchiveFile(entry.name)) items.push(entry);
      }
    }
    return [...new Map(items.map((item) => [normalizePath2(item.path), item])).values()];
  }
  async function visit(path) {
    const info = await runtime.pathInfo(path);
    if (!info.exists) return;
    if (info.isFile) {
      items.push({ name: pathName(path), path: info.path, isFile: true, isDirectory: false });
      return;
    }
    if (!info.isDirectory) return;
    for (const entry of await runtime.listDir(info.path)) {
      if (entry.isFile) items.push(entry);
      else if (entry.isDirectory && !isClassificationDirectory(entry.name)) await visit(entry.path);
    }
  }
  for (const path of paths) await visit(path);
  return [...new Map(items.map((item) => [normalizePath2(item.path), item])).values()];
}
function buildFileTransfers(files, roots, samea, crashu, input, runtime) {
  const detected = new Map(samea.items.filter((item) => item.sourcePath).map((item) => [normalizePath2(item.sourcePath), item]));
  const matchedArtists = new Set((crashu?.similarFolders ?? []).map((folder) => folder.target.toLocaleLowerCase()));
  const transfers = [];
  for (const file of files) {
    const artist = detected.get(normalizePath2(file.path))?.artistName;
    const stage = artist && matchedArtists.has(artist.toLocaleLowerCase()) ? "already" : artist && isClassfBlacklistedArtist(artist, input.blacklistKeywords) ? "del" : "wait";
    if (!isQueueEnabled(stage, input)) continue;
    const targetDir = input.placementMode === "local" ? runtime.join(runtime.dirname(file.path), stage) : rootTargetDirectory(file.path, roots, input.targetDir, stage, runtime);
    transfers.push({ sourcePath: file.path, targetDir, targetPath: runtime.join(targetDir, runtime.basename(file.path)), kind: file.isDirectory ? "folder" : "file", stage });
  }
  return transfers;
}
function rootTargetDirectory(file, roots, targetRoot, stage, runtime) {
  const owner = owningRoot(file, roots);
  const relativeFile = owner ? runtime.relative(owner, file) : runtime.basename(file);
  const preserved = roots.length > 1 && owner ? runtime.join(runtime.basename(owner), relativeFile) : relativeFile;
  const relativeDir = parentRelative(preserved);
  return relativeDir ? runtime.join(targetRoot, stage, relativeDir) : runtime.join(targetRoot, stage);
}
async function runTransferGroups(transfers, action, input, runtime, onEvent) {
  const groups = /* @__PURE__ */ new Map();
  for (const transfer of transfers) groups.set(transfer.targetDir, [...groups.get(transfer.targetDir) ?? [], transfer]);
  const results = [];
  for (const [targetPath, group] of groups) {
    const result = await runtime.runMigratef({ action, mode: "direct", sourcePaths: group.map((item) => item.sourcePath), targetPath, dryRun: action === "plan" }, onEvent);
    if (result.data) results.push(result.data);
  }
  const data3 = mergeMigrateData(results);
  return { plan: data3?.plan ?? [], data: data3 };
}
function mergeMigrateData(results) {
  if (!results.length) return void 0;
  return {
    plan: results.flatMap((item) => item.plan),
    history: results.flatMap((item) => item.history),
    migratedCount: sum(results, "migratedCount"),
    skippedCount: sum(results, "skippedCount"),
    errorCount: sum(results, "errorCount"),
    totalCount: sum(results, "totalCount"),
    operationId: results.map((item) => item.operationId).filter(Boolean).join(","),
    successCount: sum(results, "successCount"),
    failedCount: sum(results, "failedCount"),
    errors: results.flatMap((item) => item.errors)
  };
}
function transferItems(plan, transfers, roots, input, runtime) {
  const bySource = new Map(transfers.map((item) => [normalizePath2(item.sourcePath), item]));
  return plan.map((item) => {
    const transfer = bySource.get(normalizePath2(item.sourcePath));
    const stage = transfer?.stage ?? "wait";
    return {
      sourcePath: item.sourcePath,
      targetPath: item.targetPath,
      sourceName: runtime.basename(item.sourcePath),
      targetRelative: displayTarget(item.targetPath, item.sourcePath, roots, input, runtime),
      kind: transfer?.kind ?? (item.kind === "directory" ? "folder" : "file"),
      stage,
      status: item.status === "pending" ? "ready" : item.status === "success" ? item.action === "copy" ? "copied" : "moved" : item.status === "error" ? "error" : "skipped",
      reason: item.reason
    };
  });
}
function displayTarget(target, source, roots, input, runtime) {
  if (input.placementMode === "root" && input.targetDir) return runtime.relative(input.targetDir, target);
  const owner = owningRoot(source, roots);
  return owner ? runtime.relative(owner, target) : target;
}
function owningRoot(path, roots) {
  const normalized = normalizePath2(path);
  return [...roots].sort((left, right) => right.length - left.length).find((root) => normalized === normalizePath2(root) || normalized.startsWith(`${normalizePath2(root).replace(/\/$/, "")}/`));
}
function inferInputBase(paths, runtime) {
  if (!paths.length) return void 0;
  return paths.length === 1 ? paths[0] : inferCommonParent(paths, runtime);
}
function parentRelative(path) {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : "";
}
function pathName(path) {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) ?? path;
}
function isClassificationDirectory(name) {
  return ["already", "wait", "del"].includes(name.toLocaleLowerCase());
}
function isArtistGroupDirectory2(name) {
  return /^\[[^\[\]]+\]$/.test(name.trim());
}
function classificationStage(name) {
  const normalized = name.toLocaleLowerCase();
  return routeStages().find((stage) => stage === normalized);
}
function routeStages() {
  return ["already", "wait", "del"];
}
function legacyQueueSettings(classifyMode) {
  if (classifyMode === "only") return { already: true, wait: false, del: true };
  if (classifyMode === "del") return { already: false, wait: false, del: true };
  return { already: true, wait: true, del: true };
}
function isQueueEnabled(stage, input) {
  return input[`${stage}Enabled`];
}
function isSameaGroupEnabled(stage, input) {
  return isQueueEnabled(stage, input) && input[`sameaGroup${stage[0].toUpperCase()}${stage.slice(1)}Enabled`];
}
function hasSameaGrouping(input) {
  return routeStages().some((stage) => isSameaGroupEnabled(stage, input));
}
function sum(items, key) {
  return items.reduce((total, item) => total + item[key], 0);
}
function inferCommonParent(paths, runtime) {
  const parents = new Set(paths.map((path) => normalizePath2(runtime.dirname(path))));
  return parents.size === 1 ? runtime.dirname(paths[0]) : void 0;
}
function summarize2(input, items, baseDir, stages = {}) {
  const errors = items.filter((item) => item.status === "error" || item.status === "conflict").map((item) => `${item.sourcePath}: ${item.reason ?? item.status}`);
  const groupingErrors = [stages.sameaGroupAlready, stages.sameaGroupWait, stages.sameaGroupDel].flatMap((data3) => data3?.errors ?? []).map((error) => `SameA grouping: ${error}`);
  return { action: input.action, transferMode: input.transferMode, classifyMode: input.classifyMode, placementMode: input.placementMode, workItemMode: input.workItemMode, targetDir: input.targetDir, baseDir, items, selectedCount: input.paths.length, readyCount: items.filter((item) => item.status === "ready").length, movedCount: items.filter((item) => item.status === "moved").length, copiedCount: items.filter((item) => item.status === "copied").length, delCount: items.filter((item) => item.stage === "del").length, waitCount: items.filter((item) => item.stage === "wait").length, conflictCount: items.filter((item) => item.status === "conflict").length, errorCount: items.filter((item) => item.status === "error").length + groupingErrors.length, errors: [...errors, ...groupingErrors], ...stages };
}
function failure2(message, input, stages = {}) {
  return { success: false, message, data: summarize2(input, [{ sourcePath: "", targetPath: "", sourceName: "", targetRelative: "", kind: "file", stage: "samea", status: "error", reason: message }], void 0, stages) };
}
function forward(event, offset, span, sink) {
  sink(event.type === "progress" ? { ...event, progress: offset + Math.round((event.progress ?? 0) / 100 * span) } : event);
}
function forwardMigrate(event, offset, span, stage, planned, runtime, sink) {
  if (event.type !== "progress") return sink(event);
  const item = planned.find((candidate) => candidate.stage === stage && runtime.basename(candidate.sourcePath) === event.message);
  sink({ ...event, progress: offset + Math.round((event.progress ?? 0) / 100 * span), data: item ? { kind: "classf-item", sourcePath: item.sourcePath, stage, status: "running" } : event.data });
}
function emitCompletedItems(data3, stage, baseDir, runtime, sink) {
  for (const item of data3?.plan ?? []) {
    const status = item.status === "pending" ? "ready" : item.status === "success" ? item.action === "copy" ? "copied" : "moved" : item.status === "error" ? "error" : "skipped";
    sink({ type: "log", message: `${runtime.basename(item.sourcePath)}: ${status}`, data: { kind: "classf-item", sourcePath: item.sourcePath, stage, status, reason: item.reason } });
  }
}
function parseList2(value) {
  return String(value ?? "").split(/\r?\n|,/).map(clean2).filter(Boolean);
}
function uniqueClean2(values) {
  return [...new Set(values.map(clean2).filter(Boolean))];
}
function clean2(value) {
  return String(value ?? "").trim();
}
function optional(value) {
  const text = clean2(value);
  return text || void 0;
}
function normalizePath2(path) {
  return path.replace(/\\/g, "/").toLowerCase();
}
function clamp01(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.6;
}
function clampInt2(value, min, max) {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : min;
}
function errorMessage2(error) {
  return error instanceof Error ? error.message : String(error);
}

// packages/nodes/classf/src/platform.ts
init_src();

// packages/quickjs-shims/src/fs-promises.ts
init_src();
init_buffer();
init_host();
init_internal();
init_ops();
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
      `${context}: this call site is the text path, so a byte payload cannot be honoured here. Pass no encoding (or Buffer data) and the bytes go through __xrh.sendBytes on fs.writeBytes.`,
      { requiredOperation: "fs.writeBytes(path, bytes, { append? })" }
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
  const encoding = normalized.encoding;
  if (encoding === void 0 || encoding.toLowerCase() === "buffer") {
    const bytes = await opFsReadBytesAsync(target);
    if (bytes === null) throw missingDocument(target);
    return import_node_buffer.Buffer.from(bytes);
  }
  if (encoding.toLowerCase() === "utf8" || encoding.toLowerCase() === "utf-8") {
    return textFromReadResult(await opFsReadTextAsync(target), target);
  }
  const raw = await opFsReadBytesAsync(target);
  if (raw === null) throw missingDocument(target);
  return import_node_buffer.Buffer.from(raw).toString(encoding);
}
async function writeFile(path, data3, options) {
  const target = toPathString(path, "fs.promises.writeFile");
  const normalized = normalizeEncodingOption(options);
  const flag = typeof normalized.options["flag"] === "string" ? normalized.options["flag"] : "w";
  if (flag !== "w" && flag !== "a") {
    throw new QuickJsShimError(
      SHIM_ERROR_CODES.signatureUnsupported,
      `fs.promises.writeFile: flag ${JSON.stringify(flag)} maps onto neither fs.writeText (truncate) nor the append arm of fs.writeBytes; only "w" and "a" are expressible.`,
      { flag }
    );
  }
  const binary = payloadBytes(data3, normalized.encoding);
  if (binary !== null) {
    await opFsWriteBytesAsync(target, binary, { append: flag === "a" });
    return;
  }
  if (flag === "a") {
    await opFsAppendTextAsync(target, rejectBinaryPayload(data3, "fs.promises.writeFile"));
    return;
  }
  checkTextEncoding(normalized.encoding, "fs.promises.writeFile");
  await opFsWriteTextAsync(target, rejectBinaryPayload(data3, "fs.promises.writeFile"));
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
async function rename(source, destination) {
  await opFsMoveAsync(toPathString(source, "fs.promises.rename"), toPathString(destination, "fs.promises.rename"));
}
async function cp(source, destination, options) {
  const from = toPathString(source, "fs.promises.cp");
  const to = toPathString(destination, "fs.promises.cp");
  if (typeof options?.filter === "function") {
    throw new QuickJsShimError(
      SHIM_ERROR_CODES.signatureUnsupported,
      "fs.promises.cp: the filter callback cannot run host-side; the host copies the whole path, so a filtered cp would copy more than it reports.",
      { requiredOperation: "fs.copy with a host-side predicate" }
    );
  }
  const recursive = options?.recursive === true;
  if (!recursive && (await opFsStatAsync(from)).isDirectory === true) throw eisdirCopyError(from);
  await opFsCopyAsync(from, to, { recursive, force: resolveCopyForce(options ?? {}, "fs.promises.cp") });
}
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
init_src();
init_host();
init_internal();
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
var isAbsolute = (path) => isAbsoluteWith(path, native());
var relative = (from, to) => relativeWith(from, to, native());
var dirname = (path) => dirnameWith(path, native());
var basename = (path, suffix) => basenameWith(path, native(), suffix);
var _makeLong = notImplemented("path", "_makeLong");

// packages/nodes/crashu/dist/core.js
init_src();
function normalizeCrashuInput(input) {
  const sourcePaths = [...input.sourcePaths ?? input.source_paths ?? []];
  if (input.source)
    sourcePaths.unshift(input.source);
  return {
    action: input.action ?? "scan",
    sourcePaths: uniqueClean3(sourcePaths),
    source: clean3(input.source),
    targetPath: clean3(input.targetPath ?? input.target_path),
    targetNames: uniqueClean3(input.targetNames ?? input.target_names ?? []),
    destinationPath: clean3(input.destinationPath ?? input.destination_path),
    similarityThreshold: clamp012(input.similarityThreshold ?? input.similarity_threshold ?? 0.6),
    autoMove: input.autoMove ?? input.auto_move ?? false,
    moveDirection: input.moveDirection ?? input.move_direction ?? "to_target",
    conflictPolicy: input.conflictPolicy ?? input.conflict_policy ?? "skip",
    pairsFileName: clean3(input.pairsFileName ?? input.pairs_file_name) || "folder_pairs.json",
    dryRun: input.dryRun ?? false
  };
}
async function runCrashu(input, runtime, onEvent = () => {
}) {
  const normalized = normalizeCrashuInput(input);
  try {
    if (!normalized.sourcePaths.length)
      return failure3("At least one source directory is required.");
    onEvent({ type: "progress", progress: 10, message: "Validating source directories." });
    const sourceRoots = await validSourceRoots(normalized.sourcePaths, runtime);
    if (!sourceRoots.length)
      return failure3("No valid source directories found.");
    onEvent({ type: "progress", progress: 25, message: "Loading target folder names." });
    const targets = await loadTargets(normalized, runtime);
    if (!targets.length)
      return failure3("Target path or target names are required.");
    onEvent({ type: "progress", progress: 40, message: "Scanning source folders." });
    const sources = await collectSourceFolders(sourceRoots, runtime);
    const similarFolders = matchSimilarFolders(sources, targets, normalized.similarityThreshold);
    const plan = await buildCrashuPlan(similarFolders, normalized, runtime);
    if (normalized.action === "scan" || normalized.action === "plan" || normalized.dryRun || !normalized.autoMove) {
      const message = normalized.action === "scan" ? `Scan completed: ${similarFolders.length} similar folder(s).` : `Plan generated: ${plan.filter((item) => item.status === "pending").length} move(s).`;
      return success2(message, summarize3({ sources, targets, similarFolders, plan }));
    }
    onEvent({ type: "progress", progress: 70, message: "Moving matched folders." });
    return await executePlan(plan, sources, targets, similarFolders, normalized, runtime, onEvent);
  } catch (error) {
    return failure3(error instanceof Error ? error.message : String(error));
  }
}
async function collectSourceFolders(sourceRoots, runtime) {
  const folders = [];
  for (const root of sourceRoots) {
    const entries = await runtime.listDir(root);
    for (const entry of entries) {
      if (entry.isDirectory)
        folders.push({ name: entry.name, path: entry.path, sourceRoot: root });
    }
  }
  return folders.sort((a2, b2) => a2.name.localeCompare(b2.name, void 0, { numeric: true, sensitivity: "base" }));
}
async function loadTargets(input, runtime) {
  if (input.targetPath) {
    const info = await runtime.pathInfo(input.targetPath);
    if (info.exists && info.isDirectory) {
      const entries = await runtime.listDir(input.targetPath);
      return entries.filter((entry) => entry.isDirectory).map((entry) => ({ name: entry.name, path: entry.path })).sort((a2, b2) => a2.name.localeCompare(b2.name, void 0, { numeric: true, sensitivity: "base" }));
    }
  }
  return input.targetNames.map((name) => ({ name }));
}
function matchSimilarFolders(sources, targets, threshold) {
  const matches = [];
  for (const source of sources) {
    const best = bestTargetMatch(source.name, targets);
    if (!best || best.similarity < threshold)
      continue;
    matches.push({
      name: source.name,
      path: source.path,
      target: best.target.name,
      similarity: best.similarity,
      matchDim: best.matchDim,
      matchSrc: best.matchSrc,
      matchTgt: best.matchTgt,
      targetFullpath: best.target.path
    });
  }
  return matches.sort((a2, b2) => b2.similarity - a2.similarity || a2.name.localeCompare(b2.name, void 0, { numeric: true, sensitivity: "base" }));
}
async function buildCrashuPlan(similarFolders, input, runtime) {
  if (!input.destinationPath) {
    return similarFolders.map((folder) => ({
      sourcePath: folder.path,
      targetName: folder.target,
      targetPath: folder.targetFullpath,
      destinationPath: "",
      direction: input.moveDirection,
      similarity: folder.similarity,
      status: "skipped",
      reason: "missing_destination"
    }));
  }
  const plan = [];
  for (const folder of similarFolders) {
    const sourcePath = input.moveDirection === "to_source" && folder.targetFullpath ? folder.targetFullpath : folder.path;
    if (input.moveDirection === "to_source" && !folder.targetFullpath) {
      plan.push({
        sourcePath: folder.path,
        targetName: folder.target,
        destinationPath: "",
        direction: input.moveDirection,
        similarity: folder.similarity,
        status: "skipped",
        reason: "target_path_unavailable"
      });
      continue;
    }
    const destinationPath = await resolveCrashuTargetPath(folder, sourcePath, input, runtime);
    plan.push({
      sourcePath,
      targetName: folder.target,
      targetPath: folder.targetFullpath,
      destinationPath,
      direction: input.moveDirection,
      similarity: folder.similarity,
      status: destinationPath ? "pending" : "skipped",
      reason: destinationPath ? "matched" : "target_exists"
    });
  }
  return plan;
}
function normalizeFolderName(value) {
  return value.normalize("NFKC").toLowerCase().replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}|【[^】]*】|（[^）]*）/g, (part) => ` ${part.slice(1, -1)} `).replace(/[_\-+.~]+/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\b(v?\d+(?:\.\d+)?|vol(?:ume)?\s*\d+)\b/g, " $1 ").replace(/\s+/g, " ").trim();
}
function extractNameAliases(value) {
  const normalized = normalizeFolderName(value);
  const aliases = /* @__PURE__ */ new Set([normalized]);
  const bracketParts = value.match(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}|【[^】]*】|（[^）]*）/g) ?? [];
  for (const part of bracketParts) {
    for (const piece of part.slice(1, -1).split(/[|,;；、／/&+]/)) {
      const normalizedPiece = normalizeFolderName(piece);
      if (normalizedPiece.length >= 2)
        aliases.add(normalizedPiece);
    }
  }
  for (const piece of normalized.split(/\s+(?:aka|alias|vs|x)\s+/i)) {
    const normalizedPiece = normalizeFolderName(piece);
    if (normalizedPiece.length >= 2)
      aliases.add(normalizedPiece);
  }
  return [...aliases].filter(Boolean);
}
function compareFolderNames(sourceName, targetName) {
  const sourceAliases = extractNameAliases(sourceName);
  const targetAliases = extractNameAliases(targetName);
  let best = { similarity: 0, matchDim: "none", matchSrc: "", matchTgt: "" };
  for (const source of sourceAliases) {
    for (const target of targetAliases) {
      const exact = source === target ? 1 : 0;
      const token = tokenSimilarity(source, target);
      const chars = bigramSimilarity(source, target);
      const score = Math.max(exact, token, chars);
      if (score > best.similarity) {
        best = {
          similarity: score,
          matchDim: exact ? "exact" : token >= chars ? "token" : "name",
          matchSrc: source,
          matchTgt: target
        };
      }
    }
  }
  return best;
}
async function validSourceRoots(paths, runtime) {
  const roots = [];
  for (const path of paths) {
    const info = await runtime.pathInfo(path);
    if (info.exists && info.isDirectory)
      roots.push(info.path);
  }
  return roots;
}
async function executePlan(plan, sources, targets, similarFolders, input, runtime, onEvent) {
  const pending = plan.filter((item) => item.status === "pending");
  const completed = [];
  for (let index = 0; index < pending.length; index += 1) {
    const item = pending[index];
    onEvent({ type: "progress", progress: 70 + Math.round(index / Math.max(pending.length, 1) * 25), message: runtime.basename(item.sourcePath) });
    try {
      await runtime.ensureDir(runtime.dirname(item.destinationPath));
      if (input.conflictPolicy === "overwrite" && (await runtime.pathInfo(item.destinationPath)).exists) {
        await runtime.deletePath(item.destinationPath);
      }
      await runtime.movePath(item.sourcePath, item.destinationPath);
      completed.push({ ...item, status: "success" });
    } catch (error) {
      completed.push({ ...item, status: "error", reason: error instanceof Error ? error.message : String(error) });
    }
  }
  const pairsFile = input.destinationPath ? runtime.join(input.destinationPath, input.pairsFileName) : "";
  if (pairsFile) {
    await runtime.writeText(pairsFile, `${JSON.stringify({ generatedAt: (/* @__PURE__ */ new Date()).toISOString(), pairs: plan }, null, 2)}
`);
  }
  onEvent({ type: "progress", progress: 100, message: "Crashu completed." });
  const merged = plan.map((item) => completed.find((done) => done.sourcePath === item.sourcePath && done.destinationPath === item.destinationPath) ?? item);
  const summary = summarize3({ sources, targets, similarFolders, plan: merged, pairsFile });
  return {
    success: summary.errorCount === 0,
    message: `Crashu completed: ${summary.similarFound} matched, ${summary.movedCount} moved, ${summary.errorCount} error(s).`,
    data: summary
  };
}
async function resolveCrashuTargetPath(folder, sourcePath, input, runtime) {
  const baseFolder = input.moveDirection === "to_target" ? sanitizePathSegment(folder.target) : sanitizePathSegment(folder.name);
  const base = runtime.join(input.destinationPath, baseFolder);
  const desired = runtime.join(base, runtime.basename(sourcePath));
  const info = await runtime.pathInfo(desired);
  if (!info.exists)
    return desired;
  if (input.conflictPolicy === "overwrite")
    return desired;
  if (input.conflictPolicy === "skip")
    return "";
  let suffix = 2;
  let next = runtime.join(base, `${runtime.basename(sourcePath)} (${suffix})`);
  while ((await runtime.pathInfo(next)).exists) {
    suffix += 1;
    next = runtime.join(base, `${runtime.basename(sourcePath)} (${suffix})`);
  }
  return next;
}
function bestTargetMatch(sourceName, targets) {
  let best;
  for (const target of targets) {
    const result = compareFolderNames(sourceName, target.name);
    if (!best || result.similarity > best.similarity) {
      best = { target, ...result };
    }
  }
  return best;
}
function summarize3(input) {
  const moved = input.plan.filter((item) => item.status === "success").length;
  const skipped = input.plan.filter((item) => item.status === "skipped").length;
  const errors = input.plan.filter((item) => item.status === "error");
  return data({
    sourceCount: input.sources.length,
    targetCount: input.targets.length,
    totalScanned: input.sources.length,
    similarFound: input.similarFolders.length,
    movedCount: moved,
    skippedCount: skipped,
    errorCount: errors.length,
    pairsFile: input.pairsFile ?? "",
    similarFolders: input.similarFolders,
    plan: input.plan,
    errors: errors.map((item) => `${item.sourcePath}: ${item.reason}`)
  });
}
function tokenSimilarity(a2, b2) {
  const left = new Set(a2.split(/\s+/).filter(Boolean));
  const right = new Set(b2.split(/\s+/).filter(Boolean));
  if (!left.size || !right.size)
    return 0;
  let shared = 0;
  for (const token of left)
    if (right.has(token))
      shared += 1;
  return 2 * shared / (left.size + right.size);
}
function bigramSimilarity(a2, b2) {
  const left = bigrams(a2);
  const right = bigrams(b2);
  if (!left.size || !right.size)
    return 0;
  let shared = 0;
  for (const token of left)
    if (right.has(token))
      shared += 1;
  return 2 * shared / (left.size + right.size);
}
function bigrams(value) {
  const compact = value.replace(/\s+/g, "");
  if (compact.length <= 1)
    return new Set(compact ? [compact] : []);
  const grams = /* @__PURE__ */ new Set();
  for (let index = 0; index < compact.length - 1; index += 1)
    grams.add(compact.slice(index, index + 2));
  return grams;
}
function data(partial) {
  return {
    sourceCount: 0,
    targetCount: 0,
    totalScanned: 0,
    similarFound: 0,
    movedCount: 0,
    skippedCount: 0,
    errorCount: 0,
    pairsFile: "",
    similarFolders: [],
    plan: [],
    errors: [],
    ...partial
  };
}
function success2(message, partial) {
  return { success: true, message, data: data(partial) };
}
function failure3(message) {
  return { success: false, message, data: data({ errors: [message], errorCount: 1 }) };
}
function sanitizePathSegment(value) {
  const sanitized = value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim();
  return sanitized || "target";
}
function uniqueClean3(values) {
  return [...new Set(values.map(clean3).filter(Boolean))];
}
function clean3(value) {
  return (value ?? "").trim().replace(/^["']|["']$/g, "");
}
function clamp012(value) {
  if (!Number.isFinite(value))
    return 0.6;
  return Math.min(1, Math.max(0, value));
}

// packages/nodes/crashu/dist/platform.js
init_src();

// packages/quickjs-shims/src/child-process.ts
init_src();
init_host();
init_internal();
init_ops();
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
var exec = notImplemented("child_process", "exec", "shell string parsing bypasses the allowlist; call execFile(program, argv) instead");
var execSync = notImplemented("child_process", "execSync", "shell string parsing bypasses the allowlist; call execFileSync(program, argv) instead");
var fork = notImplemented("child_process", "fork", "a Node fork needs a JS runtime on the other end; the realm has one and it is this one");

// packages/nodes/crashu/dist/platform.js
function createNodeCrashuRuntime() {
  return {
    pathInfo,
    listDir,
    ensureDir: (path) => mkdir(path, { recursive: true }).then(() => void 0),
    movePath,
    deletePath: (path) => rm(path, { recursive: true, force: true }),
    writeText: async (path, content) => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, "utf8");
    },
    join,
    dirname,
    basename
  };
}
async function pathInfo(path) {
  const resolved = resolve(path);
  try {
    const info = await stat(resolved);
    return { path: resolved, exists: true, isFile: info.isFile(), isDirectory: info.isDirectory() };
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

// packages/nodes/migratef/dist/core.js
init_src();
function normalizeMigratefInput(input) {
  const paths = [...input.sourcePaths ?? []];
  if (input.path)
    paths.unshift(input.path);
  return {
    action: input.action ?? "move",
    mode: input.mode ?? "preserve",
    path: clean4(input.path),
    sourcePaths: [...new Set(paths.map(clean4).filter(Boolean))],
    targetPath: clean4(input.targetPath),
    maxWorkers: input.maxWorkers ?? 16,
    batchId: clean4(input.batchId),
    historyLimit: input.historyLimit ?? 10,
    historyPath: clean4(input.historyPath),
    dryRun: input.dryRun ?? false,
    relativeTargetBase: input.relativeTargetBase ?? "working-directory",
    mergeExistingDirectories: input.mergeExistingDirectories ?? false
  };
}
async function runMigratef(input, runtime, onEvent = () => {
}) {
  const normalized = normalizeMigratefInput(input);
  try {
    if (normalized.action === "history")
      return await history(normalized, runtime);
    if (normalized.action === "undo")
      return await undo(normalized, runtime, onEvent);
    const plan = await buildMigratefPlan(normalized, runtime);
    if (normalized.action === "plan" || normalized.dryRun) {
      return success3(`Plan generated: ${plan.filter((item) => item.status === "pending").length} item(s).`, {
        plan,
        totalCount: plan.length,
        skippedCount: plan.filter((item) => item.status === "skipped").length
      });
    }
    return await executePlan2(normalized, plan, runtime, onEvent);
  } catch (error) {
    return failure4(error instanceof Error ? error.message : String(error));
  }
}
async function buildMigratefPlan(input, runtime) {
  if (!input.sourcePaths.length)
    throw new Error("At least one source path is required.");
  if (!input.targetPath)
    throw new Error("Target path is required.");
  const action = input.action === "copy" ? "copy" : "move";
  const plan = [];
  for (const source of input.sourcePaths) {
    const info = await runtime.pathInfo(source);
    if (!info.exists) {
      plan.push({ sourcePath: source, targetPath: "", action, kind: "file", status: "skipped", reason: "source_missing" });
      continue;
    }
    if (input.mode === "direct") {
      const targetRoot = resolveTargetRoot(input, info, runtime);
      const targetPath = runtime.join(targetRoot, runtime.basename(info.path));
      const targetInfo = await runtime.pathInfo(targetPath);
      if (targetInfo.exists && runtime.resolve(info.path) === runtime.resolve(targetInfo.path)) {
        plan.push({
          sourcePath: info.path,
          targetPath: targetInfo.path,
          action,
          kind: info.isDirectory ? "directory" : "file",
          status: "skipped",
          reason: "source_target_same"
        });
        continue;
      }
      if (input.mergeExistingDirectories && info.isDirectory && targetInfo.isDirectory) {
        await appendMergedDirectoryPlan(info.path, targetInfo.path, action, runtime, plan);
        continue;
      }
      plan.push({
        sourcePath: info.path,
        targetPath,
        action,
        kind: info.isDirectory ? "directory" : "file",
        status: targetInfo.exists ? "skipped" : "pending",
        ...targetInfo.exists ? { reason: "target_exists" } : {}
      });
      continue;
    }
    const files = await collectFiles(info, input.mode === "preserve", runtime);
    if (!files.length) {
      plan.push({ sourcePath: info.path, targetPath: "", action, kind: info.isDirectory ? "directory" : "file", status: "skipped", reason: "no_files" });
      continue;
    }
    for (const file of files) {
      const targetPath = input.mode === "preserve" ? runtime.join(input.targetPath, preserveRelativeTarget(file.path)) : runtime.join(input.targetPath, runtime.basename(file.path));
      plan.push({ sourcePath: file.path, targetPath, action, kind: "file", status: "pending" });
    }
  }
  return plan;
}
async function collectFiles(source, recursive, runtime) {
  if (source.isFile)
    return [source];
  if (!source.isDirectory)
    return [];
  const files = [];
  async function walk(path) {
    for (const entry of await runtime.listDir(path)) {
      if (entry.isFile)
        files.push({ path: entry.path, exists: true, isFile: true, isDirectory: false });
      else if (entry.isDirectory && recursive)
        await walk(entry.path);
    }
  }
  await walk(source.path);
  return files;
}
function preserveRelativeTarget(path) {
  return path.replace(/^[A-Za-z]:/, "").replace(/^[/\\]+/, "").replace(/[:*?"<>|]/g, "_");
}
function parseMigratefHistory(content) {
  if (!content?.trim())
    return [];
  try {
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed))
      return [];
    return parsed.filter(isUndoRecord);
  } catch {
    return [];
  }
}
function dumpMigratefHistory(records) {
  return `${JSON.stringify(records, null, 2)}
`;
}
async function executePlan2(input, plan, runtime, onEvent) {
  const pending = plan.filter((item) => item.status === "pending");
  let migratedCount = 0;
  let errorCount = 0;
  const completed = [];
  const removedSourceDirectories = [];
  for (let index = 0; index < pending.length; index += 1) {
    const item = pending[index];
    onEvent({ type: "progress", progress: Math.round(index / Math.max(pending.length, 1) * 100), message: runtime.basename(item.sourcePath) });
    try {
      if (item.operation === "remove-empty-source") {
        const remaining = await runtime.listDir(item.sourcePath);
        if (remaining.length)
          throw new Error(`Source directory is not empty: ${item.sourcePath}`);
        await runtime.deletePath(item.sourcePath);
        removedSourceDirectories.push(item.sourcePath);
        completed.push({ ...item, status: "success" });
        continue;
      }
      await runtime.ensureDir(runtime.dirname(item.targetPath));
      if (item.action === "copy") {
        if (item.kind === "directory")
          await runtime.copyDir(item.sourcePath, item.targetPath);
        else
          await runtime.copyFile(item.sourcePath, item.targetPath);
      } else {
        await runtime.movePath(item.sourcePath, item.targetPath);
      }
      completed.push({ ...item, status: "success" });
      migratedCount += 1;
    } catch (error) {
      completed.push({ ...item, status: "error", reason: error instanceof Error ? error.message : String(error) });
      errorCount += 1;
    }
  }
  const skipped = plan.filter((item) => item.status === "skipped");
  const operationId = await recordUndoIfNeeded(input, completed, removedSourceDirectories, runtime);
  onEvent({ type: "progress", progress: 100, message: "Migration completed." });
  return {
    success: errorCount === 0,
    message: `${input.action === "copy" ? "Copy" : "Move"} completed: ${migratedCount} success, ${skipped.length} skipped, ${errorCount} failed.`,
    data: data2({
      plan: [...skipped, ...completed],
      migratedCount,
      skippedCount: skipped.length,
      errorCount,
      totalCount: plan.length,
      operationId
    })
  };
}
async function recordUndoIfNeeded(input, completed, removedSourceDirectories, runtime) {
  const successful = completed.filter((item) => item.status === "success" && item.operation !== "remove-empty-source");
  if (!successful.length && !removedSourceDirectories.length)
    return "";
  const id = runtime.randomId();
  const record = {
    id,
    timestamp: runtime.now().toISOString(),
    description: `${input.mode} ${input.action} to ${input.targetPath}`,
    action: input.action === "copy" ? "copy" : "move",
    operations: successful.map((item) => ({ sourcePath: item.sourcePath, targetPath: item.targetPath, action: item.action })),
    ...removedSourceDirectories.length ? { removedSourceDirectories } : {}
  };
  const path = historyPath(input, runtime);
  const records = parseMigratefHistory(await runtime.readText(path));
  records.unshift(record);
  await runtime.writeText(path, dumpMigratefHistory(records.slice(0, 100)));
  return id;
}
async function history(input, runtime) {
  const records = parseMigratefHistory(await runtime.readText(historyPath(input, runtime))).slice(0, input.historyLimit);
  return success3(`Loaded ${records.length} history record(s).`, { history: records });
}
async function undo(input, runtime, onEvent) {
  const path = historyPath(input, runtime);
  const records = parseMigratefHistory(await runtime.readText(path));
  const record = input.batchId ? records.find((item) => item.id === input.batchId) : records.find((item) => !item.undone);
  if (!record)
    return failure4(input.batchId ? `Undo batch not found: ${input.batchId}` : "No undoable batch found.");
  if (record.undone)
    return failure4(`Undo batch already applied: ${record.id}`);
  let successCount = 0;
  let failedCount = 0;
  const errors = [];
  const operations = [...record.operations].reverse();
  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index];
    onEvent({ type: "progress", progress: Math.round(index / Math.max(operations.length, 1) * 100), message: operation.targetPath });
    try {
      if (record.action === "move") {
        await runtime.ensureDir(runtime.dirname(operation.sourcePath));
        await runtime.movePath(operation.targetPath, operation.sourcePath);
      } else {
        await runtime.deletePath(operation.targetPath);
      }
      successCount += 1;
    } catch (error) {
      failedCount += 1;
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (record.action === "move") {
    const removedDirectories = [...record.removedSourceDirectories ?? []].sort((left, right) => left.length - right.length);
    for (const directory of removedDirectories) {
      try {
        await runtime.ensureDir(directory);
      } catch (error) {
        failedCount += 1;
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  }
  record.undone = failedCount === 0;
  await runtime.writeText(path, dumpMigratefHistory(records));
  onEvent({ type: "progress", progress: 100, message: "Undo completed." });
  return {
    success: failedCount === 0,
    message: `Undo completed: ${successCount} success, ${failedCount} failed.`,
    data: data2({ history: records, successCount, failedCount, errors })
  };
}
function historyPath(input, runtime) {
  return input.historyPath || runtime.defaultHistoryPath();
}
function clean4(value) {
  return (value ?? "").trim().replace(/^["']|["']$/g, "");
}
function resolveTargetRoot(input, source, runtime) {
  if (runtime.isAbsolute(input.targetPath) || input.relativeTargetBase === "working-directory")
    return input.targetPath;
  return runtime.resolve(runtime.dirname(source.path), input.targetPath);
}
async function appendMergedDirectoryPlan(sourceDirectory, targetDirectory, action, runtime, plan) {
  let canRemoveSource = action === "move";
  for (const entry of await runtime.listDir(sourceDirectory)) {
    const targetPath = runtime.join(targetDirectory, entry.name);
    const targetInfo = await runtime.pathInfo(targetPath);
    if (!targetInfo.exists) {
      plan.push({
        sourcePath: entry.path,
        targetPath,
        action,
        kind: entry.isDirectory ? "directory" : "file",
        operation: "transfer",
        status: "pending"
      });
      continue;
    }
    if (entry.isDirectory && targetInfo.isDirectory) {
      const nestedRemovable = await appendMergedDirectoryPlan(entry.path, targetInfo.path, action, runtime, plan);
      canRemoveSource = canRemoveSource && nestedRemovable;
      continue;
    }
    plan.push({
      sourcePath: entry.path,
      targetPath: targetInfo.path,
      action,
      kind: entry.isDirectory ? "directory" : "file",
      operation: "transfer",
      status: "skipped",
      reason: "target_exists"
    });
    canRemoveSource = false;
  }
  if (canRemoveSource) {
    plan.push({
      sourcePath: sourceDirectory,
      targetPath: targetDirectory,
      action,
      kind: "directory",
      operation: "remove-empty-source",
      status: "pending"
    });
  }
  return canRemoveSource;
}
function isUndoRecord(value) {
  if (!value || typeof value !== "object")
    return false;
  const record = value;
  return typeof record.id === "string" && typeof record.timestamp === "string" && Array.isArray(record.operations);
}
function data2(partial) {
  return {
    plan: [],
    history: [],
    migratedCount: 0,
    skippedCount: 0,
    errorCount: 0,
    totalCount: 0,
    operationId: "",
    successCount: 0,
    failedCount: 0,
    errors: [],
    ...partial
  };
}
function success3(message, partial) {
  return { success: true, message, data: data2(partial) };
}
function failure4(message) {
  return { success: false, message, data: data2({ errors: [message], failedCount: 1 }) };
}

// packages/nodes/migratef/dist/platform.js
init_src();

// packages/config/dist/index.js
init_src();

// packages/config/dist/paths.js
init_src();

// packages/platform/dist/index.js
init_src();

// packages/quickjs-shims/src/os.ts
init_src();
init_internal();
init_host();
init_ops();
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

// packages/platform/dist/hostMemory.js
init_src();

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

// packages/config/dist/schema.js
init_src();

// packages/config/node_modules/zod/index.js
init_src();

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
init_src();

// packages/config/node_modules/zod/v3/errors.js
init_src();

// packages/config/node_modules/zod/v3/locales/en.js
init_src();

// packages/config/node_modules/zod/v3/ZodError.js
init_src();

// packages/config/node_modules/zod/v3/helpers/util.js
init_src();
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
    return util2.objectKeys(obj).map(function(e2) {
      return obj[e2];
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
var getParsedType = (data3) => {
  const t2 = typeof data3;
  switch (t2) {
    case "undefined":
      return ZodParsedType.undefined;
    case "string":
      return ZodParsedType.string;
    case "number":
      return Number.isNaN(data3) ? ZodParsedType.nan : ZodParsedType.number;
    case "boolean":
      return ZodParsedType.boolean;
    case "function":
      return ZodParsedType.function;
    case "bigint":
      return ZodParsedType.bigint;
    case "symbol":
      return ZodParsedType.symbol;
    case "object":
      if (Array.isArray(data3)) {
        return ZodParsedType.array;
      }
      if (data3 === null) {
        return ZodParsedType.null;
      }
      if (data3.then && typeof data3.then === "function" && data3.catch && typeof data3.catch === "function") {
        return ZodParsedType.promise;
      }
      if (typeof Map !== "undefined" && data3 instanceof Map) {
        return ZodParsedType.map;
      }
      if (typeof Set !== "undefined" && data3 instanceof Set) {
        return ZodParsedType.set;
      }
      if (typeof Date !== "undefined" && data3 instanceof Date) {
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
          let i2 = 0;
          while (i2 < issue.path.length) {
            const el = issue.path[i2];
            const terminal = i2 === issue.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
            }
            curr = curr[el];
            i2++;
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
init_src();
var makeIssue = (params) => {
  const { data: data3, path, errorMaps, issueData } = params;
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
  let errorMessage3 = "";
  const maps = errorMaps.filter((m2) => !!m2).slice().reverse();
  for (const map of maps) {
    errorMessage3 = map(fullIssue, { data: data3, defaultError: errorMessage3 }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage3
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
    for (const s2 of results) {
      if (s2.status === "aborted")
        return INVALID;
      if (s2.status === "dirty")
        status.dirty();
      arrayValue.push(s2.value);
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

// packages/config/node_modules/zod/v3/types.js
init_src();

// packages/config/node_modules/zod/v3/helpers/errorUtil.js
init_src();
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
  parse(data3, params) {
    const result = this.safeParse(data3, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  safeParse(data3, params) {
    const ctx = {
      common: {
        issues: [],
        async: params?.async ?? false,
        contextualErrorMap: params?.errorMap
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data: data3,
      parsedType: getParsedType(data3)
    };
    const result = this._parseSync({ data: data3, path: ctx.path, parent: ctx });
    return handleResult(ctx, result);
  }
  "~validate"(data3) {
    const ctx = {
      common: {
        issues: [],
        async: !!this["~standard"].async
      },
      path: [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data: data3,
      parsedType: getParsedType(data3)
    };
    if (!this["~standard"].async) {
      try {
        const result = this._parseSync({ data: data3, path: [], parent: ctx });
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
    return this._parseAsync({ data: data3, path: [], parent: ctx }).then((result) => isValid(result) ? {
      value: result.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data3, params) {
    const result = await this.safeParseAsync(data3, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  async safeParseAsync(data3, params) {
    const ctx = {
      common: {
        issues: [],
        contextualErrorMap: params?.errorMap,
        async: true
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data: data3,
      parsedType: getParsedType(data3)
    };
    const maybeAsyncResult = this._parse({ data: data3, path: ctx.path, parent: ctx });
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
        return result.then((data3) => {
          if (!data3) {
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
      validate: (data3) => this["~validate"](data3)
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
    return this.refinement((data3) => regex.test(data3), {
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
      return Promise.all([...ctx.data].map((item, i2) => {
        return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i2));
      })).then((result2) => {
        return ParseStatus.mergeArray(status, result2);
      });
    }
    const result = [...ctx.data].map((item, i2) => {
      return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i2));
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
function mergeValues(a2, b2) {
  const aType = getParsedType(a2);
  const bType = getParsedType(b2);
  if (a2 === b2) {
    return { valid: true, data: a2 };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b2);
    const sharedKeys = util.objectKeys(a2).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a2, ...b2 };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a2[key], b2[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a2.length !== b2.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0; index < a2.length; index++) {
      const itemA = a2[index];
      const itemB = b2[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a2 === +b2) {
    return { valid: true, data: a2 };
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
    const elements = [...ctx.data.values()].map((item, i2) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i2)));
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
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e2) => {
          error.addIssue(makeArgsIssue(args, e2));
          throw error;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e2) => {
          error.addIssue(makeReturnsIssue(result, e2));
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
    return OK(promisified.then((data3) => {
      return this._def.type.parseAsync(data3, {
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
    let data3 = ctx.data;
    if (ctx.parsedType === ZodParsedType.undefined) {
      data3 = this._def.defaultValue();
    }
    return this._def.innerType._parse({
      data: data3,
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
    const data3 = ctx.data;
    return this._def.type._parse({
      data: data3,
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
  static create(a2, b2) {
    return new _ZodPipeline({
      in: a2,
      out: b2,
      typeName: ZodFirstPartyTypeKind.ZodPipeline
    });
  }
};
var ZodReadonly = class extends ZodType {
  _parse(input) {
    const result = this._def.innerType._parse(input);
    const freeze = (data3) => {
      if (isValid(data3)) {
        data3.value = Object.freeze(data3.value);
      }
      return data3;
    };
    return isAsync(result) ? result.then((data3) => freeze(data3)) : freeze(result);
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
function cleanParams(params, data3) {
  const p2 = typeof params === "function" ? params(data3) : typeof params === "string" ? { message: params } : params;
  const p22 = typeof p2 === "string" ? { message: p2 } : p2;
  return p22;
}
function custom(check, _params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data3, ctx) => {
      const r2 = check(data3);
      if (r2 instanceof Promise) {
        return r2.then((r3) => {
          if (!r3) {
            const params = cleanParams(_params, data3);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r2) {
        const params = cleanParams(_params, data3);
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
}) => custom((data3) => data3 instanceof cls, params);
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

// packages/config/dist/xiraniteToml.js
init_src();

// node_modules/smol-toml/dist/index.js
init_src();

// node_modules/smol-toml/dist/parse.js
init_src();

// node_modules/smol-toml/dist/struct.js
init_src();

// node_modules/smol-toml/dist/primitive.js
init_src();

// node_modules/smol-toml/dist/date.js
init_src();

// node_modules/smol-toml/dist/error.js
init_src();

// node_modules/smol-toml/dist/extract.js
init_src();

// node_modules/smol-toml/dist/util.js
init_src();

// node_modules/smol-toml/dist/stringify.js
init_src();

// packages/config/dist/transport.js
init_src();

// packages/nodes/migratef/dist/platform.js
function createNodeMigratefRuntime() {
  return {
    pathInfo: pathInfo2,
    listDir: listDir2,
    ensureDir: (path) => mkdir(path, { recursive: true }).then(() => void 0),
    copyFile: async (source, target) => {
      await mkdir(dirname(target), { recursive: true });
      await cp(source, target, { force: true });
    },
    copyDir: async (source, target) => {
      await mkdir(dirname(target), { recursive: true });
      await cp(source, target, { recursive: true, force: false, errorOnExist: true });
    },
    movePath: movePath2,
    deletePath: (path) => rm(path, { recursive: true, force: true }),
    readText,
    writeText,
    join,
    dirname,
    basename,
    isAbsolute,
    resolve,
    now: () => /* @__PURE__ */ new Date(),
    randomId: () => crypto.randomUUID().slice(0, 8),
    defaultHistoryPath: () => join(dirname(resolveXiraniteConfigPath()), "artifacts", "undo", "migratef.undo.json")
  };
}
async function readClipboardText() {
  if (process.platform === "win32") {
    const result = await runCommand("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "$ProgressPreference = 'SilentlyContinue'; Get-Clipboard -Raw"
    ]);
    return result.code === 0 ? result.stdout.trim() : "";
  }
  if (process.platform === "darwin") {
    const result = await runCommand("pbpaste", []);
    return result.code === 0 ? result.stdout.trim() : "";
  }
  for (const command of [["wl-paste"], ["xclip", "-selection", "clipboard", "-o"], ["xsel", "--clipboard", "--output"]]) {
    const result = await runCommand(command[0], command.slice(1));
    if (result.code === 0 && result.stdout.trim())
      return result.stdout.trim();
  }
  return "";
}
async function runCommand(command, args) {
  return await new Promise((resolve2) => {
    execFile(command, args, { encoding: "utf8", windowsHide: true }, (error, stdout) => {
      const code = typeof error?.code === "number" ? Number(error.code) : error ? 1 : 0;
      resolve2({ code, stdout: stdout ?? "" });
    });
  });
}
async function pathInfo2(path) {
  const resolved = resolve(path);
  try {
    const stat2 = await lstat(resolved);
    return { path: resolved, exists: true, isFile: stat2.isFile(), isDirectory: stat2.isDirectory() };
  } catch {
    return { path: resolved, exists: false, isFile: false, isDirectory: false };
  }
}
async function listDir2(path) {
  const entries = await readdir(path, { withFileTypes: true });
  return entries.map((entry) => ({
    name: entry.name,
    path: join(path, entry.name),
    isFile: entry.isFile(),
    isDirectory: entry.isDirectory()
  }));
}
async function movePath2(source, target) {
  await mkdir(dirname(target), { recursive: true });
  try {
    await rename(source, target);
  } catch {
    await cp(source, target, { recursive: true, force: false, errorOnExist: true });
    await rm(source, { recursive: true, force: true });
  }
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

// packages/nodes/samea/dist/platform.js
init_src();
function createNodeSameaRuntime() {
  return {
    pathInfo: async (path) => {
      try {
        const info = await stat(path);
        return { path, exists: true, isFile: info.isFile(), isDirectory: info.isDirectory() };
      } catch {
        return { path, exists: false, isFile: false, isDirectory: false };
      }
    },
    listDir: async (path) => (await readdir(path, { withFileTypes: true })).map((entry) => ({ name: entry.name, path: join(path, entry.name), isFile: entry.isFile(), isDirectory: entry.isDirectory() })),
    ensureDir: async (path) => {
      await mkdir(path, { recursive: true });
    },
    movePath: async (source, target) => {
      await mkdir(dirname(target), { recursive: true });
      await rename(source, target);
    },
    join,
    dirname,
    basename
  };
}

// packages/nodes/classf/src/platform.ts
function createNodeClassfRuntime() {
  return {
    runSamea: (input, onEvent) => runSamea(input, createNodeSameaRuntime(), onEvent),
    runCrashu: (input, onEvent) => runCrashu(input, createNodeCrashuRuntime(), onEvent),
    runMigratef: (input, onEvent) => runMigratef(input, createNodeMigratefRuntime(), onEvent),
    readClipboardPaths: async () => (await readClipboardText()).split(/\r?\n/).map((path) => path.trim()).filter(Boolean),
    pathInfo: async (path) => {
      try {
        const info = await stat(path);
        return { path, exists: true, isFile: info.isFile(), isDirectory: info.isDirectory() };
      } catch {
        return { path, exists: false, isFile: false, isDirectory: false };
      }
    },
    listDir: async (path) => (await readdir(path, { withFileTypes: true })).map((entry) => ({ name: entry.name, path: join(path, entry.name), isFile: entry.isFile(), isDirectory: entry.isDirectory() })),
    join,
    dirname,
    basename,
    relative
  };
}
export {
  createNodeClassfRuntime,
  runClassf
};
/*! Bundled license information:

ieee754/index.js:
  (*! ieee754. BSD-3-Clause License. Feross Aboukhadijeh <https://feross.org/opensource> *)

node-buffer/index.js:
  (*!
   * The buffer module from node.js, for the browser.
   *
   * @author   Feross Aboukhadijeh <https://feross.org>
   * @license  MIT
   *)

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
