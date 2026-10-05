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
    for (i = 0, len = code.length; i < len; ++i) {
      lookup[i] = code[i];
      revLookup[code.charCodeAt(i)] = i;
    }
    var i;
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
      var i2;
      for (i2 = 0; i2 < len2; i2 += 4) {
        tmp = revLookup[b64.charCodeAt(i2)] << 18 | revLookup[b64.charCodeAt(i2 + 1)] << 12 | revLookup[b64.charCodeAt(i2 + 2)] << 6 | revLookup[b64.charCodeAt(i2 + 3)];
        arr[curByte++] = tmp >> 16 & 255;
        arr[curByte++] = tmp >> 8 & 255;
        arr[curByte++] = tmp & 255;
      }
      if (placeHoldersLen === 2) {
        tmp = revLookup[b64.charCodeAt(i2)] << 2 | revLookup[b64.charCodeAt(i2 + 1)] >> 4;
        arr[curByte++] = tmp & 255;
      }
      if (placeHoldersLen === 1) {
        tmp = revLookup[b64.charCodeAt(i2)] << 10 | revLookup[b64.charCodeAt(i2 + 1)] << 4 | revLookup[b64.charCodeAt(i2 + 2)] >> 2;
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
      for (var i2 = start; i2 < end; i2 += 3) {
        tmp = (uint8[i2] << 16 & 16711680) + (uint8[i2 + 1] << 8 & 65280) + (uint8[i2 + 2] & 255);
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
      for (var i2 = 0, len22 = len2 - extraBytes; i2 < len22; i2 += maxChunkLength) {
        parts.push(encodeChunk(uint8, i2, i2 + maxChunkLength > len22 ? len22 : i2 + maxChunkLength));
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
      var e, m;
      var eLen = nBytes * 8 - mLen - 1;
      var eMax = (1 << eLen) - 1;
      var eBias = eMax >> 1;
      var nBits = -7;
      var i = isLE ? nBytes - 1 : 0;
      var d = isLE ? -1 : 1;
      var s = buffer[offset + i];
      i += d;
      e = s & (1 << -nBits) - 1;
      s >>= -nBits;
      nBits += eLen;
      for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8) {
      }
      m = e & (1 << -nBits) - 1;
      e >>= -nBits;
      nBits += mLen;
      for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8) {
      }
      if (e === 0) {
        e = 1 - eBias;
      } else if (e === eMax) {
        return m ? NaN : (s ? -1 : 1) * Infinity;
      } else {
        m = m + Math.pow(2, mLen);
        e = e - eBias;
      }
      return (s ? -1 : 1) * m * Math.pow(2, e - mLen);
    };
    exports.write = function(buffer, value, offset, isLE, mLen, nBytes) {
      var e, m, c;
      var eLen = nBytes * 8 - mLen - 1;
      var eMax = (1 << eLen) - 1;
      var eBias = eMax >> 1;
      var rt = mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0;
      var i = isLE ? 0 : nBytes - 1;
      var d = isLE ? 1 : -1;
      var s = value < 0 || value === 0 && 1 / value < 0 ? 1 : 0;
      value = Math.abs(value);
      if (isNaN(value) || value === Infinity) {
        m = isNaN(value) ? 1 : 0;
        e = eMax;
      } else {
        e = Math.floor(Math.log(value) / Math.LN2);
        if (value * (c = Math.pow(2, -e)) < 1) {
          e--;
          c *= 2;
        }
        if (e + eBias >= 1) {
          value += rt / c;
        } else {
          value += rt * Math.pow(2, 1 - eBias);
        }
        if (value * c >= 2) {
          e++;
          c /= 2;
        }
        if (e + eBias >= eMax) {
          m = 0;
          e = eMax;
        } else if (e + eBias >= 1) {
          m = (value * c - 1) * Math.pow(2, mLen);
          e = e + eBias;
        } else {
          m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen);
          e = 0;
        }
      }
      for (; mLen >= 8; buffer[offset + i] = m & 255, i += d, m /= 256, mLen -= 8) {
      }
      e = e << mLen | m;
      eLen += mLen;
      for (; eLen > 0; buffer[offset + i] = e & 255, i += d, e /= 256, eLen -= 8) {
      }
      buffer[offset + i - d] |= s * 128;
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
      } catch (e) {
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
      const b = fromObject(value);
      if (b) return b;
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
      for (let i = 0; i < length; i += 1) {
        buf[i] = array[i] & 255;
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
    Buffer3.isBuffer = function isBuffer(b) {
      return b != null && b._isBuffer === true && b !== Buffer3.prototype;
    };
    Buffer3.compare = function compare(a, b) {
      if (isInstance(a, Uint8Array)) a = Buffer3.from(a, a.offset, a.byteLength);
      if (isInstance(b, Uint8Array)) b = Buffer3.from(b, b.offset, b.byteLength);
      if (!Buffer3.isBuffer(a) || !Buffer3.isBuffer(b)) {
        throw new TypeError(
          'The "buf1", "buf2" arguments must be one of type Buffer or Uint8Array'
        );
      }
      if (a === b) return 0;
      let x = a.length;
      let y = b.length;
      for (let i = 0, len = Math.min(x, y); i < len; ++i) {
        if (a[i] !== b[i]) {
          x = a[i];
          y = b[i];
          break;
        }
      }
      if (x < y) return -1;
      if (y < x) return 1;
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
      let i;
      if (length === void 0) {
        length = 0;
        for (i = 0; i < list.length; ++i) {
          length += list[i].length;
        }
      }
      const buffer = Buffer3.allocUnsafe(length);
      let pos = 0;
      for (i = 0; i < list.length; ++i) {
        let buf = list[i];
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
    function swap(b, n, m) {
      const i = b[n];
      b[n] = b[m];
      b[m] = i;
    }
    Buffer3.prototype.swap16 = function swap16() {
      const len = this.length;
      if (len % 2 !== 0) {
        throw new RangeError("Buffer size must be a multiple of 16-bits");
      }
      for (let i = 0; i < len; i += 2) {
        swap(this, i, i + 1);
      }
      return this;
    };
    Buffer3.prototype.swap32 = function swap32() {
      const len = this.length;
      if (len % 4 !== 0) {
        throw new RangeError("Buffer size must be a multiple of 32-bits");
      }
      for (let i = 0; i < len; i += 4) {
        swap(this, i, i + 3);
        swap(this, i + 1, i + 2);
      }
      return this;
    };
    Buffer3.prototype.swap64 = function swap64() {
      const len = this.length;
      if (len % 8 !== 0) {
        throw new RangeError("Buffer size must be a multiple of 64-bits");
      }
      for (let i = 0; i < len; i += 8) {
        swap(this, i, i + 7);
        swap(this, i + 1, i + 6);
        swap(this, i + 2, i + 5);
        swap(this, i + 3, i + 4);
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
    Buffer3.prototype.equals = function equals(b) {
      if (!Buffer3.isBuffer(b)) throw new TypeError("Argument must be a Buffer");
      if (this === b) return true;
      return Buffer3.compare(this, b) === 0;
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
      let y = end - start;
      const len = Math.min(x, y);
      const thisCopy = this.slice(thisStart, thisEnd);
      const targetCopy = target.slice(start, end);
      for (let i = 0; i < len; ++i) {
        if (thisCopy[i] !== targetCopy[i]) {
          x = thisCopy[i];
          y = targetCopy[i];
          break;
        }
      }
      if (x < y) return -1;
      if (y < x) return 1;
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
      function read(buf, i2) {
        if (indexSize === 1) {
          return buf[i2];
        } else {
          return buf.readUInt16BE(i2 * indexSize);
        }
      }
      let i;
      if (dir) {
        let foundIndex = -1;
        for (i = byteOffset; i < arrLength; i++) {
          if (read(arr, i) === read(val, foundIndex === -1 ? 0 : i - foundIndex)) {
            if (foundIndex === -1) foundIndex = i;
            if (i - foundIndex + 1 === valLength) return foundIndex * indexSize;
          } else {
            if (foundIndex !== -1) i -= i - foundIndex;
            foundIndex = -1;
          }
        }
      } else {
        if (byteOffset + valLength > arrLength) byteOffset = arrLength - valLength;
        for (i = byteOffset; i >= 0; i--) {
          let found = true;
          for (let j = 0; j < valLength; j++) {
            if (read(arr, i + j) !== read(val, j)) {
              found = false;
              break;
            }
          }
          if (found) return i;
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
      let i;
      for (i = 0; i < length; ++i) {
        const parsed = parseInt(string.substr(i * 2, 2), 16);
        if (numberIsNaN(parsed)) return i;
        buf[offset + i] = parsed;
      }
      return i;
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
      let i = start;
      while (i < end) {
        const firstByte = buf[i];
        let codePoint = null;
        let bytesPerSequence = firstByte > 239 ? 4 : firstByte > 223 ? 3 : firstByte > 191 ? 2 : 1;
        if (i + bytesPerSequence <= end) {
          let secondByte, thirdByte, fourthByte, tempCodePoint;
          switch (bytesPerSequence) {
            case 1:
              if (firstByte < 128) {
                codePoint = firstByte;
              }
              break;
            case 2:
              secondByte = buf[i + 1];
              if ((secondByte & 192) === 128) {
                tempCodePoint = (firstByte & 31) << 6 | secondByte & 63;
                if (tempCodePoint > 127) {
                  codePoint = tempCodePoint;
                }
              }
              break;
            case 3:
              secondByte = buf[i + 1];
              thirdByte = buf[i + 2];
              if ((secondByte & 192) === 128 && (thirdByte & 192) === 128) {
                tempCodePoint = (firstByte & 15) << 12 | (secondByte & 63) << 6 | thirdByte & 63;
                if (tempCodePoint > 2047 && (tempCodePoint < 55296 || tempCodePoint > 57343)) {
                  codePoint = tempCodePoint;
                }
              }
              break;
            case 4:
              secondByte = buf[i + 1];
              thirdByte = buf[i + 2];
              fourthByte = buf[i + 3];
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
        i += bytesPerSequence;
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
      let i = 0;
      while (i < len) {
        res += String.fromCharCode.apply(
          String,
          codePoints.slice(i, i += MAX_ARGUMENTS_LENGTH)
        );
      }
      return res;
    }
    function asciiSlice(buf, start, end) {
      let ret = "";
      end = Math.min(buf.length, end);
      for (let i = start; i < end; ++i) {
        ret += String.fromCharCode(buf[i] & 127);
      }
      return ret;
    }
    function latin1Slice(buf, start, end) {
      let ret = "";
      end = Math.min(buf.length, end);
      for (let i = start; i < end; ++i) {
        ret += String.fromCharCode(buf[i]);
      }
      return ret;
    }
    function hexSlice(buf, start, end) {
      const len = buf.length;
      if (!start || start < 0) start = 0;
      if (!end || end < 0 || end > len) end = len;
      let out = "";
      for (let i = start; i < end; ++i) {
        out += hexSliceLookupTable[buf[i]];
      }
      return out;
    }
    function utf16leSlice(buf, start, end) {
      const bytes = buf.slice(start, end);
      let res = "";
      for (let i = 0; i < bytes.length - 1; i += 2) {
        res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256);
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
      let i = 0;
      while (++i < byteLength2 && (mul *= 256)) {
        val += this[offset + i] * mul;
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
      const first2 = this[offset];
      const last = this[offset + 7];
      if (first2 === void 0 || last === void 0) {
        boundsError(offset, this.length - 8);
      }
      const lo = first2 + this[++offset] * 2 ** 8 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 24;
      const hi = this[++offset] + this[++offset] * 2 ** 8 + this[++offset] * 2 ** 16 + last * 2 ** 24;
      return BigInt(lo) + (BigInt(hi) << BigInt(32));
    });
    Buffer3.prototype.readBigUInt64BE = defineBigIntMethod(function readBigUInt64BE(offset) {
      offset = offset >>> 0;
      validateNumber(offset, "offset");
      const first2 = this[offset];
      const last = this[offset + 7];
      if (first2 === void 0 || last === void 0) {
        boundsError(offset, this.length - 8);
      }
      const hi = first2 * 2 ** 24 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 8 + this[++offset];
      const lo = this[++offset] * 2 ** 24 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 8 + last;
      return (BigInt(hi) << BigInt(32)) + BigInt(lo);
    });
    Buffer3.prototype.readIntLE = function readIntLE(offset, byteLength2, noAssert) {
      offset = offset >>> 0;
      byteLength2 = byteLength2 >>> 0;
      if (!noAssert) checkOffset(offset, byteLength2, this.length);
      let val = this[offset];
      let mul = 1;
      let i = 0;
      while (++i < byteLength2 && (mul *= 256)) {
        val += this[offset + i] * mul;
      }
      mul *= 128;
      if (val >= mul) val -= Math.pow(2, 8 * byteLength2);
      return val;
    };
    Buffer3.prototype.readIntBE = function readIntBE(offset, byteLength2, noAssert) {
      offset = offset >>> 0;
      byteLength2 = byteLength2 >>> 0;
      if (!noAssert) checkOffset(offset, byteLength2, this.length);
      let i = byteLength2;
      let mul = 1;
      let val = this[offset + --i];
      while (i > 0 && (mul *= 256)) {
        val += this[offset + --i] * mul;
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
      const first2 = this[offset];
      const last = this[offset + 7];
      if (first2 === void 0 || last === void 0) {
        boundsError(offset, this.length - 8);
      }
      const val = this[offset + 4] + this[offset + 5] * 2 ** 8 + this[offset + 6] * 2 ** 16 + (last << 24);
      return (BigInt(val) << BigInt(32)) + BigInt(first2 + this[++offset] * 2 ** 8 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 24);
    });
    Buffer3.prototype.readBigInt64BE = defineBigIntMethod(function readBigInt64BE(offset) {
      offset = offset >>> 0;
      validateNumber(offset, "offset");
      const first2 = this[offset];
      const last = this[offset + 7];
      if (first2 === void 0 || last === void 0) {
        boundsError(offset, this.length - 8);
      }
      const val = (first2 << 24) + // Overflow
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
      let i = 0;
      this[offset] = value & 255;
      while (++i < byteLength2 && (mul *= 256)) {
        this[offset + i] = value / mul & 255;
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
      let i = byteLength2 - 1;
      let mul = 1;
      this[offset + i] = value & 255;
      while (--i >= 0 && (mul *= 256)) {
        this[offset + i] = value / mul & 255;
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
      let i = 0;
      let mul = 1;
      let sub = 0;
      this[offset] = value & 255;
      while (++i < byteLength2 && (mul *= 256)) {
        if (value < 0 && sub === 0 && this[offset + i - 1] !== 0) {
          sub = 1;
        }
        this[offset + i] = (value / mul >> 0) - sub & 255;
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
      let i = byteLength2 - 1;
      let mul = 1;
      let sub = 0;
      this[offset + i] = value & 255;
      while (--i >= 0 && (mul *= 256)) {
        if (value < 0 && sub === 0 && this[offset + i + 1] !== 0) {
          sub = 1;
        }
        this[offset + i] = (value / mul >> 0) - sub & 255;
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
      let i;
      if (typeof val === "number") {
        for (i = start; i < end; ++i) {
          this[i] = val;
        }
      } else {
        const bytes = Buffer3.isBuffer(val) ? val : Buffer3.from(val, encoding);
        const len = bytes.length;
        if (len === 0) {
          throw new TypeError('The value "' + val + '" is invalid for argument "value"');
        }
        for (i = 0; i < end - start; ++i) {
          this[i + start] = bytes[i % len];
        }
      }
      return this;
    };
    var errors = {};
    function E(sym, getMessage, Base) {
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
    E(
      "ERR_BUFFER_OUT_OF_BOUNDS",
      function(name) {
        if (name) {
          return `${name} is outside of buffer bounds`;
        }
        return "Attempt to access memory outside buffer bounds";
      },
      RangeError
    );
    E(
      "ERR_INVALID_ARG_TYPE",
      function(name, actual) {
        return `The "${name}" argument must be of type number. Received type ${typeof actual}`;
      },
      TypeError
    );
    E(
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
      let i = val.length;
      const start = val[0] === "-" ? 1 : 0;
      for (; i >= start + 4; i -= 3) {
        res = `_${val.slice(i - 3, i)}${res}`;
      }
      return `${val.slice(0, i)}${res}`;
    }
    function checkBounds(buf, offset, byteLength2) {
      validateNumber(offset, "offset");
      if (buf[offset] === void 0 || buf[offset + byteLength2] === void 0) {
        boundsError(offset, buf.length - (byteLength2 + 1));
      }
    }
    function checkIntBI(value, min, max, buf, offset, byteLength2) {
      if (value > max || value < min) {
        const n = typeof min === "bigint" ? "n" : "";
        let range;
        if (byteLength2 > 3) {
          if (min === 0 || min === BigInt(0)) {
            range = `>= 0${n} and < 2${n} ** ${(byteLength2 + 1) * 8}${n}`;
          } else {
            range = `>= -(2${n} ** ${(byteLength2 + 1) * 8 - 1}${n}) and < 2 ** ${(byteLength2 + 1) * 8 - 1}${n}`;
          }
        } else {
          range = `>= ${min}${n} and <= ${max}${n}`;
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
      for (let i = 0; i < length; ++i) {
        codePoint = string.charCodeAt(i);
        if (codePoint > 55295 && codePoint < 57344) {
          if (!leadSurrogate) {
            if (codePoint > 56319) {
              if ((units -= 3) > -1) bytes.push(239, 191, 189);
              continue;
            } else if (i + 1 === length) {
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
      for (let i = 0; i < str.length; ++i) {
        byteArray.push(str.charCodeAt(i) & 255);
      }
      return byteArray;
    }
    function utf16leToBytes(str, units) {
      let c, hi, lo;
      const byteArray = [];
      for (let i = 0; i < str.length; ++i) {
        if ((units -= 2) < 0) break;
        c = str.charCodeAt(i);
        hi = c >> 8;
        lo = c % 256;
        byteArray.push(lo);
        byteArray.push(hi);
      }
      return byteArray;
    }
    function base64ToBytes2(str) {
      return base64.toByteArray(base64clean(str));
    }
    function blitBuffer(src, dst, offset, length) {
      let i;
      for (i = 0; i < length; ++i) {
        if (i + offset >= dst.length || i >= src.length) break;
        dst[i + offset] = src[i];
      }
      return i;
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
      for (let i = 0; i < 16; ++i) {
        const i16 = i * 16;
        for (let j = 0; j < 16; ++j) {
          table[i16 + j] = alphabet[i] + alphabet[j];
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
  const h = host();
  if (typeof h.callAsync === "function") {
    let raw;
    try {
      raw = await h.callAsync(op, JSON.stringify(args ?? {}));
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
  const h = host();
  if (typeof h.callBytes !== "function") {
    throw new QuickJsShimError(SHIM_ERROR_CODES.hostMissing, `${op} answers bytes but this host installed no __xrh.callBytes.`, { operation: op });
  }
  let answer;
  try {
    answer = h.callBytes(op, JSON.stringify(args ?? {}));
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
  const h = host();
  if (typeof h.callAsync !== "function") return hostCallBytes(op, args);
  let answer;
  try {
    answer = await h.callAsync(op, JSON.stringify(args ?? {}));
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
  const h = host();
  if (typeof h.sendBytes !== "function") {
    throw new QuickJsShimError(SHIM_ERROR_CODES.hostMissing, `${op} takes a byte payload but this host installed no __xrh.sendBytes.`, { operation: op });
  }
  let raw;
  try {
    raw = h.sendBytes(op, JSON.stringify(args ?? {}), bytes);
  } catch (cause) {
    throw asShimError(op, cause);
  }
  return decodeHostResult(op, raw);
}
async function hostSendBytesAsync(op, args, bytes) {
  const h = host();
  if (typeof h.callAsync !== "function") return hostSendBytes(op, args, bytes);
  let raw;
  try {
    raw = await h.callAsync(op, JSON.stringify(args ?? {}), bytes);
  } catch (cause) {
    throw asShimError(op, cause);
  }
  if (typeof raw !== "string") {
    throw new QuickJsShimError(SHIM_ERROR_CODES.hostResultInvalid, `${op} answered bytes to a payload call.`, { operation: op });
  }
  return decodeHostResult(op, raw);
}
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
var init_internal = __esm({
  "packages/quickjs-shims/src/internal.ts"() {
    "use strict";
    init_src();
    init_host();
    init_constants();
  }
});

// packages/quickjs-shims/src/buffer.ts
var import_node_buffer, transpile, resolveObjectURL;
var init_buffer = __esm({
  "packages/quickjs-shims/src/buffer.ts"() {
    "use strict";
    init_src();
    import_node_buffer = __toESM(require_node_buffer(), 1);
    init_host();
    init_internal();
    transpile = notImplemented("buffer", "transpile");
    resolveObjectURL = notImplemented("buffer", "resolveObjectURL", "blob: URLs are not the realm's");
  }
});

// packages/quickjs-shims/src/ops.ts
function opRandomUUID() {
  return String(hostCall("crypto.randomUUID", {}));
}
function opRandomBytes(length) {
  return hostCall("crypto.randomBytes", { length });
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

// artifacts/.node-bundle-meta/gifu.host-entry.ts
init_src();

// packages/nodes/gifu/src/core.ts
init_src();
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
  const text2 = input.configText || (input.configPath ? await runtime.readText(input.configPath) : "");
  if (!text2.trim()) return {};
  return parseGifuTomlConfig(text2);
}
async function readListFileInput(path2, runtime) {
  return { paths: parsePathList(await runtime.readText(path2)) };
}
async function loadGifuConfigSummary(input, runtime) {
  const text2 = input.configText || (input.configPath ? await runtime.readText(input.configPath) : "");
  if (!text2.trim()) return void 0;
  const parsed = parseTomlLikeKeys(text2);
  return { path: input.configPath, keys: parsed.keys, tables: parsed.tables };
}
function mergeGifuConfigInput(config, input) {
  const merged = { ...config };
  for (const [key, value] of Object.entries(input)) {
    if (value !== void 0) merged[key] = value;
  }
  return merged;
}
function parseGifuTomlConfig(text2) {
  const values = parseTomlLikeValues(text2);
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
function parseTomlLikeKeys(text2) {
  const keys = /* @__PURE__ */ new Set();
  const tables = /* @__PURE__ */ new Set();
  let table = "";
  for (const raw of text2.split(/\r?\n/)) {
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
  const path2 = input.databasePath || defaultGifuDatabasePath(input, archives, runtime);
  if (!path2) return void 0;
  return { path: path2, enabled: input.recordRun, mode: "jsonl", defaultPath: !input.databasePath };
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
  async function add(path2) {
    const key = path2.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    found.push(path2);
  }
  async function visit(path2) {
    const info = await runtime.pathInfo(path2);
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
  for (const path2 of paths) await visit(path2);
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
  for (const path2 of paths.slice(1)) {
    const parent = runtime.dirname(path2);
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
function parsePathList(text2) {
  return text2.split(/\r?\n|;/).map(clean).filter((line) => line && !line.startsWith("#"));
}
function isGifuArchive(path2) {
  const lower = path2.toLowerCase();
  return GIFU_ARCHIVE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}
function isGifuImage(path2) {
  const lower = path2.toLowerCase();
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
function parseTomlLikeValues(text2) {
  const values = {};
  let table = "";
  for (const raw of text2.split(/\r?\n/)) {
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
  const text2 = String(value ?? "").trim();
  if (text2.length >= 2 && (text2.startsWith('"') && text2.endsWith('"') || text2.startsWith("'") && text2.endsWith("'"))) return text2.slice(1, -1).trim();
  return text2;
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

// packages/nodes/gifu/src/platform.ts
init_src();

// packages/host-capabilities/src/realm.ts
init_src();
init_host();

// packages/host-capabilities/src/path-realm.ts
init_src();
init_host();
function normalizeSeparators(path2) {
  return path2.replace(/\\/g, "/");
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
  return hostIsWindows() ? win32Engine : posixEngine;
}
function hostIsWindows() {
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
function isAbsoluteWith(path2, engine) {
  if (engine.win32) {
    if (path2.length >= 2 && (path2[0] === "\\" || path2[0] === "/" || path2[1] === "\\" || path2[1] === "/")) return true;
    return /^[A-Za-z]:[\\/]/.test(path2);
  }
  return path2.startsWith("/");
}
function normalizeSegments(path2, engine, allowAboveRoot) {
  const out = [];
  for (const segment of path2.split(sepClass(engine))) {
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
function rootLength(path2, engine) {
  if (engine.win32) {
    if (path2.length >= 2 && (path2[0] === "\\" || path2[0] === "/") && (path2[1] === "\\" || path2[1] === "/")) {
      const second = path2.indexOf("\\", 2);
      const secondAlt = path2.indexOf("/", 2);
      const next = second === -1 ? secondAlt : secondAlt === -1 ? second : Math.min(second, secondAlt);
      if (next === -1) return path2.length;
      const third = indexOfAny(path2, next + 1, "\\/");
      return third === -1 ? path2.length : third;
    }
    if (/^[A-Za-z]:[\\/]/.test(path2)) return 3;
    return 0;
  }
  return path2.startsWith("/") ? 1 : 0;
}
function indexOfAny(path2, from, characters) {
  for (let index = from; index < path2.length; index += 1) {
    if (characters.includes(path2[index])) return index;
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
function normalizeWith(path2, engine) {
  if (path2.length === 0) return ".";
  const isAbs = isAbsoluteWith(path2, engine);
  const root = path2.slice(0, rootLength(path2, engine));
  const trailing = isSeparator(engine, path2[path2.length - 1]);
  const segments = normalizeSegments(path2, engine, !isAbs);
  if (segments.length === 0 && isAbs) return root.length > 0 ? root : engine.sep;
  if (segments.length === 0) return isAbs ? engine.sep : ".";
  const prefixed = isAbs ? `${root}${segments}` : segments;
  return trailing ? `${prefixed}${engine.sep}` : prefixed;
}
function dirnameWith(path2, engine) {
  if (path2.length === 0) return ".";
  const root = path2.slice(0, rootLength(path2, engine));
  let end = path2.length;
  while (end > 1 && end > root.length + 1 && isSeparator(engine, path2[end - 1])) end -= 1;
  let last = -1;
  for (let index = end - 1; index >= 1; index -= 1) {
    if (isSeparator(engine, path2[index])) {
      last = index;
      break;
    }
  }
  if (last < root.length) {
    if (root.length > 0) return root;
    return isAbsoluteWith(path2, engine) ? engine.sep : ".";
  }
  const parent = path2.slice(0, last);
  if (engine.win32 && /^[A-Za-z]:$/.test(parent)) return `${parent}\\`;
  if (parent.length === 0) return engine.sep;
  return parent;
}
function basenameWith(path2, engine, suffix) {
  let base = path2;
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
function extnameWith(path2, engine) {
  const base = basenameWith(path2, engine);
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
function parseWith(path2, engine) {
  if (path2.length === 0) throw new QuickJsShimError(SHIM_ERROR_CODES.signatureUnsupported, "path.parse expects a non-empty string.");
  const root = path2.slice(0, rootLength(path2, engine));
  const dir = path2 === root ? "" : dirnameWith(path2, engine);
  const base = basenameWith(path2, engine);
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
    normalize: (path2) => normalizeWith(path2, engine),
    join: (...parts) => {
      const kept = parts.filter((part) => typeof part === "string" && part.length > 0);
      if (kept.length === 0) return ".";
      return normalizeWith(kept.join(engine.sep), engine);
    },
    resolve: (...parts) => resolveWith(parts, engine),
    isAbsolute: (path2) => isAbsoluteWith(path2, engine),
    relative: (from, to) => relativeWith(from, to, engine),
    dirname: (path2) => dirnameWith(path2, engine),
    basename: (path2, suffix) => basenameWith(path2, engine, suffix),
    extname: (path2) => extnameWith(path2, engine),
    parse: (path2) => parseWith(path2, engine),
    format: (parsed) => formatWith(parsed, engine),
    toNamespacedPath: (path2) => path2
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
var normalize = (path2) => normalizeWith(path2, native());
var resolve = (...parts) => resolveWith(parts, native());
var isAbsolute = (path2) => isAbsoluteWith(path2, native());
var relative = (from, to) => relativeWith(from, to, native());
var dirname = (path2) => dirnameWith(path2, native());
var basename = (path2, suffix) => basenameWith(path2, native(), suffix);
var extname = (path2) => extnameWith(path2, native());
var parse = (path2) => parseWith(path2, native());

// packages/host-capabilities/src/contract.ts
init_src();

// packages/host-capabilities/src/operations.generated.ts
init_src();

// packages/host-capabilities/src/contract.ts
var CAPABILITY_FOR_OPERATION = {
  "fs.stat": "fs.stat",
  "fs.list": "fs.list",
  "fs.readText": "fs.readText",
  "fs.writeText": "fs.writeText",
  "fs.ensureDir": "fs.ensureDir",
  "fs.move": "fs.move",
  "fs.delete": "fs.remove",
  "fs.mkdtemp": "fs.createTemp",
  "fs.copy": "fs.copy",
  "fs.appendText": "fs.appendText",
  "fs.utimes": "fs.setTimes",
  "fs.readBytes": "fs.readBytes",
  "fs.writeBytes": "fs.writeBytes",
  "fs.link": "fs.hardLink",
  "fs.symlink": "fs.symbolicLink",
  "fs.readlink": "fs.readLink",
  "fs.realpath": "fs.realPath",
  "proc.exec": "proc.exec",
  "proc.spawn": "proc.start",
  "proc.poll": "proc.poll",
  "proc.wait": "proc.wait",
  "proc.kill": "proc.stop",
  "clock.now": "clock.now",
  "clock.sleep": "clock.sleep",
  "crypto.randomUUID": "crypto.uuid",
  "crypto.randomBytes": "crypto.randomBytes",
  "crypto.digest": "crypto.digest",
  "os.tmpdir": "os.tempDir",
  "os.homedir": "os.homeDir",
  "os.cpus": "os.cpus",
  "service.invoke": "service.invoke"
};
var CAPABILITY_PATHS = Object.values(CAPABILITY_FOR_OPERATION);

// packages/host-capabilities/src/realm.ts
function kindOf(entry) {
  if (typeof entry.kind === "string") return entry.kind;
  if (entry.isFile === true) return "file";
  if (entry.isDirectory === true) return "dir";
  if (entry.isSymlink === true) return "symlink";
  return "other";
}
function asRecord(value) {
  if (typeof value !== "object" || value === null) {
    throw new TypeError(`host-capabilities: the realm answered ${typeof value} where an object was pinned`);
  }
  return value;
}
function text(value, field) {
  if (typeof value !== "string") throw new TypeError(`host-capabilities: answer field "${field}" is not text`);
  return value;
}
function optionalNumber(value) {
  return typeof value === "number" ? value : null;
}
function hostJoin(parent, name) {
  const sep3 = platformInfo().sep || "/";
  return parent.endsWith(sep3) ? `${parent}${name}` : `${parent}${sep3}${name}`;
}
async function stat(path2) {
  const answer = asRecord(await hostCallAsync("fs.stat", { path: path2 }));
  if (answer.exists === false) return null;
  return {
    path: typeof answer.path === "string" ? answer.path : path2,
    kind: kindOf(answer),
    sizeBytes: optionalNumber(answer.sizeBytes ?? answer.size),
    mtimeMs: optionalNumber(answer.mtimeMs),
    atimeMs: optionalNumber(answer.atimeMs)
  };
}
var realmCapabilities = {
  path: {
    join,
    resolve,
    normalize,
    dirname,
    basename,
    extname,
    relative,
    isAbsolute,
    parse,
    sep
  },
  fs: {
    stat,
    async list(path2, options = {}) {
      const answer = asRecord(await hostCallAsync("fs.list", { path: path2, ...options }));
      const entries = Array.isArray(answer.entries) ? answer.entries : [];
      return entries.map((raw) => {
        const entry = asRecord(raw);
        const name = text(entry.name, "fs.list entry name");
        return {
          name,
          path: typeof entry.path === "string" ? entry.path : hostJoin(path2, name),
          kind: kindOf(entry)
        };
      });
    },
    async readText(path2) {
      const answer = asRecord(await hostCallAsync("fs.readText", { path: path2 }));
      return answer.content === null || answer.content === void 0 ? null : text(answer.content, "content");
    },
    async writeText(path2, content) {
      await hostCallAsync("fs.writeText", { path: path2, content });
    },
    async appendText(path2, content) {
      await hostCallAsync("fs.appendText", { path: path2, content });
    },
    async readBytes(path2, options = {}) {
      return await hostCallBytesAsync("fs.readBytes", { path: path2, ...options });
    },
    async writeBytes(path2, bytes, options = {}) {
      await hostSendBytesAsync("fs.writeBytes", { path: path2, append: options.append ?? false }, bytes);
    },
    async ensureDir(path2) {
      await hostCallAsync("fs.ensureDir", { path: path2 });
    },
    async createTemp(prefix) {
      return text(asRecord(await hostCallAsync("fs.mkdtemp", { prefix })).path, "fs.mkdtemp path");
    },
    async move(source, target) {
      await hostCallAsync("fs.move", { source, target });
    },
    async copy(source, target, options = {}) {
      await hostCallAsync("fs.copy", { source, target, ...options });
    },
    async remove(path2, options = {}) {
      await hostCallAsync("fs.delete", { path: path2, recursive: options.recursive ?? false });
    },
    async hardLink(source, target) {
      await hostCallAsync("fs.link", { source, target });
    },
    async symbolicLink(target, path2, kind) {
      await hostCallAsync("fs.symlink", { target, path: path2, ...kind === void 0 ? {} : { type: kind } });
    },
    async readLink(path2) {
      return text(asRecord(await hostCallAsync("fs.readlink", { path: path2 })).target, "fs.readlink target");
    },
    async realPath(path2) {
      return text(asRecord(await hostCallAsync("fs.realpath", { path: path2 })).realPath, "fs.realpath realPath");
    },
    async setTimes(path2, times) {
      await hostCallAsync("fs.utimes", { path: path2, atimeMs: times.atimeMs, mtimeMs: times.mtimeMs });
    }
  },
  proc: {
    async exec(program, args, options = {}) {
      const answer = asRecord(await hostCallAsync("proc.exec", { program, args, ...options }));
      return {
        exitCode: answer.exitCode === null || answer.exitCode === void 0 ? null : Number(answer.exitCode),
        stdout: typeof answer.stdout === "string" ? answer.stdout : "",
        stderr: typeof answer.stderr === "string" ? answer.stderr : "",
        truncated: answer.truncated === true
      };
    },
    async start(program, args, options = {}) {
      const answer = asRecord(await hostCallAsync("proc.spawn", { program, args, ...options }));
      return { handle: Number(answer.handle), pid: Number(answer.pid) };
    },
    async poll(handle, since = 0) {
      return statusOf(asRecord(await hostCallAsync("proc.poll", { handle, since })));
    },
    async wait(handle, since = 0) {
      return statusOf(asRecord(await hostCallAsync("proc.wait", { handle, since })));
    },
    async stop(handle) {
      return asRecord(await hostCallAsync("proc.kill", { handle })).killed === true;
    }
  },
  clock: {
    now() {
      return text(hostCall("clock.now", {}), "clock.now");
    },
    async sleep(milliseconds) {
      const waited = hostCall("clock.sleep", { ms: milliseconds });
      if (typeof waited !== "number" || !Number.isFinite(waited)) {
        throw new Error(`clock.sleep answered ${JSON.stringify(waited)}, not a millisecond count`);
      }
      return waited;
    }
  },
  crypto: {
    uuid() {
      return text(hostCall("crypto.randomUUID", {}), "crypto.randomUUID");
    },
    async randomBytes(count) {
      const hex = text(await hostCallAsync("crypto.randomBytes", { count }), "crypto.randomBytes");
      const bytes = new Uint8Array(count);
      for (let index = 0; index < count; index += 1) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
      return bytes;
    },
    async digest(algorithm, bytes) {
      return text(asRecord(await hostSendBytesAsync("crypto.digest", { algorithm }, bytes)).hex, "crypto.digest hex");
    }
  },
  os: {
    tempDir() {
      return text(hostCall("os.tmpdir", {}), "os.tmpdir");
    },
    async homeDir() {
      const answer = await hostCallAsync("os.homedir", {});
      return typeof answer === "string" ? answer : null;
    },
    async cpus() {
      const answer = asRecord(await hostCallAsync("os.cpus", {}));
      const listed = Array.isArray(answer.cpus) ? answer.cpus : [];
      return {
        count: Number(answer.count ?? listed.length),
        models: listed.map((cpu) => text(asRecord(cpu).model, "os.cpus model"))
      };
    },
    async platform() {
      const info = platformInfo();
      return { platform: info.platform, arch: info.arch, sep: info.sep, cwd: info.cwd, env: hostEnv() };
    }
  },
  service: {
    async invoke(name, method, args = {}) {
      return await hostCallAsync("service.invoke", { service: name, method, args });
    }
  }
};
function statusOf(answer) {
  return {
    running: answer.running === true,
    exitCode: answer.exitCode === null || answer.exitCode === void 0 ? null : Number(answer.exitCode),
    stdout: typeof answer.stdout === "string" ? answer.stdout : "",
    stderr: typeof answer.stderr === "string" ? answer.stderr : "",
    truncated: answer.truncated === true
  };
}
var hostCapabilities = realmCapabilities;

// packages/nodes/gifu/src/platform.ts
var { path } = hostCapabilities;
var { basename: basename2, dirname: dirname2, extname: extname2, join: join2, relative: relative2, resolve: resolve2, sep: sep2 } = path;
var SEVEN_ZIP_NAMES = ["7z", "7zz", "7za", "7z.exe", "7zz.exe", "7za.exe"];
var FFMPEG_NAMES = ["ffmpeg", "ffmpeg.exe"];
var FFPROBE_NAMES = ["ffprobe", "ffprobe.exe"];
function createNodeGifuRuntime() {
  const handles = /* @__PURE__ */ new Set();
  let cancelled = false;
  let sevenZipPromise;
  let ffmpegPromise;
  let ffprobePromise;
  const trackedCommand = (command, args, options = {}) => runCommand(command, args, { ...options, handles });
  return {
    readText: readTextOrThrow,
    appendRecord,
    pathInfo,
    listDir,
    async listArchiveImages(path2) {
      cancelled = false;
      sevenZipPromise ??= findSevenZip();
      const sevenZip = await sevenZipPromise;
      if (!sevenZip) throw new Error("7-Zip was not found. Install 7-Zip or add 7z to PATH.");
      const result = await trackedCommand(sevenZip, ["l", "-slt", "-ba", path2]);
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
      for (const handle of handles) {
        try {
          void hostCapabilities.proc.stop(handle).catch(() => void 0);
        } catch {
        }
      }
    },
    isCancelled: () => cancelled,
    join: join2,
    dirname: dirname2,
    basename: basename2,
    extname: extname2,
    relative: relative2
  };
}
function parse7zImageEntries(text2) {
  const entries = [];
  let record = {};
  function flush() {
    const path2 = record.Path?.trim();
    const folder = record.Folder === "+" || /D/.test(record.Attributes ?? "") || path2?.endsWith("/") || path2?.endsWith("\\");
    if (path2 && !folder && isGifuImage(path2)) {
      entries.push({
        path: path2.replace(/\\/g, "/"),
        extension: extname2(path2).toLowerCase(),
        size: numberOrUndefined(record.Size)
      });
    }
    record = {};
  }
  for (const raw of text2.split(/\r?\n/)) {
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
  const { fs } = hostCapabilities;
  const workspace = await fs.createTemp("xiranite-gifu-");
  const extractedRoot = join2(workspace, "archive");
  const framesRoot = join2(workspace, "frames");
  try {
    await fs.ensureDir(extractedRoot);
    const extraction = await tools.run(tools.sevenZip, ["x", "-y", `-o${extractedRoot}`, task.archivePath]);
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
      await fs.ensureDir(dirname2(outputPath));
      await fs.copy(extractedImages[0].path, outputPath);
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
    await fs.ensureDir(framesRoot);
    const resizeFlags = task.format === "webm" || task.format === "mp4" ? "bilinear" : "lanczos";
    let decodedFrames = 0;
    for (const image of probed) {
      if (tools.isCancelled()) throw new Error("Conversion cancelled.");
      const framePath = join2(framesRoot, `frame-${String(decodedFrames).padStart(8, "0")}.png`);
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
    await fs.ensureDir(dirname2(task.outputPath));
    const encode = await encodeAnimation(task, tools.ffmpeg, framesRoot, decodedFrames, tools.run);
    if (encode.result.code !== 0) {
      await hostCapabilities.fs.remove(task.outputPath).catch(() => void 0);
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
    await fs.remove(workspace, { recursive: true }).catch(() => void 0);
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
    join2(framesRoot, "frame-%08d.png"),
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
  await hostCapabilities.fs.remove(task.outputPath).catch(() => void 0);
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
async function probeImage(ffprobe, path2, run) {
  const result = await run(ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", path2]);
  if (result.code !== 0) return null;
  try {
    const parsed = JSON.parse(result.stdout);
    const stream = parsed.streams?.[0];
    return stream && Number(stream.width) > 0 && Number(stream.height) > 0 ? { width: Number(stream.width), height: Number(stream.height) } : null;
  } catch {
    return null;
  }
}
async function pathInfo(path2) {
  const info = await hostCapabilities.fs.stat(path2);
  if (!info) return { path: path2, exists: false, isFile: false, isDirectory: false };
  return { path: resolve2(path2), exists: true, isFile: info.kind === "file", isDirectory: info.kind === "dir" };
}
async function listDir(path2) {
  return (await hostCapabilities.fs.list(path2)).map((entry) => ({
    name: entry.name,
    path: entry.path,
    isFile: entry.kind === "file",
    isDirectory: entry.kind === "dir"
  }));
}
async function appendRecord(path2, record) {
  const { fs } = hostCapabilities;
  await fs.ensureDir(dirname2(path2));
  await fs.appendText(path2, `${JSON.stringify(record)}
`);
}
async function findSevenZip() {
  const { env } = await hostCapabilities.os.platform();
  const configured = env.GIFU_7Z?.trim();
  if (configured && await exists(configured)) return configured;
  const found = await findExecutable(SEVEN_ZIP_NAMES);
  if (found) return found;
  for (const candidate of [
    "C:\\Program Files\\7-Zip\\7z.exe",
    "C:\\Program Files (x86)\\7-Zip\\7z.exe",
    join2(env.LOCALAPPDATA ?? "", "7-Zip", "7z.exe")
  ]) if (candidate && await exists(candidate)) return candidate;
  return null;
}
async function findFfmpeg() {
  const { env } = await hostCapabilities.os.platform();
  const configured = env.GIFU_FFMPEG?.trim();
  if (configured && await exists(configured)) return configured;
  return findExecutable(FFMPEG_NAMES);
}
async function findFfprobe(ffmpeg) {
  const { env, platform } = await hostCapabilities.os.platform();
  const configured = env.GIFU_FFPROBE?.trim();
  if (configured && await exists(configured)) return configured;
  if (ffmpeg) {
    const sibling = join2(dirname2(ffmpeg), platform === "win32" ? "ffprobe.exe" : "ffprobe");
    if (await exists(sibling)) return sibling;
  }
  return findExecutable(FFPROBE_NAMES);
}
async function findExecutable(names) {
  const { platform } = await hostCapabilities.os.platform();
  const locator = platform === "win32" ? "where.exe" : "which";
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
  const { proc } = hostCapabilities;
  const started = await proc.start(command, args, options.cwd ? { cwd: options.cwd } : void 0);
  options.handles?.add(started.handle);
  try {
    const status = await proc.wait(started.handle);
    return {
      // A handle `cancel()` stopped answers `exitCode: null`; `CommandResult.code` is a plain number and
      // every caller here reads non-zero as failure.
      code: status.exitCode ?? 1,
      stdout: status.stdout,
      stderr: status.stderr
    };
  } finally {
    options.handles?.delete(started.handle);
  }
}
function safeExtractedPath(root, entryPath) {
  const candidate = resolve2(root, entryPath.replace(/[\\/]/g, sep2));
  const rel = relative2(root, candidate);
  if (rel === ".." || rel.startsWith(`..${sep2}`) || resolve2(rel) === rel) return null;
  return candidate;
}
function replaceExtension(path2, extension) {
  const normalized = extension.startsWith(".") ? extension : `.${extension}`;
  return path2.slice(0, path2.length - extname2(path2).length) + normalized;
}
async function assertWritableOutput(path2, overwrite) {
  if (!overwrite && await exists(path2)) throw new Error(`Output already exists: ${path2}`);
}
async function isFile(path2) {
  return (await hostCapabilities.fs.stat(path2))?.kind === "file";
}
async function isNonEmptyFile(path2) {
  const info = await hostCapabilities.fs.stat(path2);
  return info?.kind === "file" && (info.sizeBytes ?? 0) > 0;
}
async function exists(path2) {
  return await hostCapabilities.fs.stat(path2) !== null;
}
async function readTextOrThrow(path2) {
  const text2 = await hostCapabilities.fs.readText(path2);
  if (text2 === null) throw new Error(`ENOENT: no such file or directory, open '${path2}'`);
  return text2;
}
function numberOrUndefined(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : void 0;
}
export {
  createNodeGifuRuntime,
  runGifu
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
*/
