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
      "proc.spawn(program, args, { cwd }) -> { handle, pid, program }     // + proc.poll/wait/kill by numeric handle"
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
function opOsCpus() {
  return hostCall("os.cpus", {});
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

// artifacts/.node-bundle-meta/sleept.host-entry.ts
init_src();

// packages/nodes/sleept/src/core.ts
init_src();
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

// packages/nodes/sleept/src/platform.ts
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
var spawn = notImplemented("child_process", "spawn", "proc.spawn(program, args, { cwd }) -> handle");
var spawnSync = notImplemented("child_process", "spawnSync", "proc.exec already waits; spawnSync needs no new op but is not wired here");
var exec = notImplemented("child_process", "exec", "shell string parsing bypasses the allowlist; call execFile(program, argv) instead");
var execSync = notImplemented("child_process", "execSync", "shell string parsing bypasses the allowlist; call execFileSync(program, argv) instead");
var fork = notImplemented("child_process", "fork");

// packages/quickjs-shims/src/util.ts
init_src();
init_internal();
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
init_src();
init_internal();
init_host();
init_ops();
var EOL = platformInfoOrFallback().platform === "win32" ? "\r\n" : "\n";
var hostname = notImplemented("os", "hostname");
function cpus() {
  return opOsCpus().cpus;
}
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
