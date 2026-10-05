/**
 * Deep equality for the `node:assert` shim — pure TypeScript, no host call, shared by `assert.ts` and reachable
 * by `util.isDeepEqual` consumers.
 *
 * Both of Node's two comparison modes are reproduced because they are *different contracts* and a node that
 * picks one means it: `looseEqual` (what `assert.deepEqual` uses) and `strictEqual` (what
 * `assert.deepStrictEqual` uses). Each rule below was measured against Node 26 before being written, and
 * `assert.test.ts` replays the same table against the live `node:assert`:
 * - primitives: loose uses `==` with the NaN pair treated equal (`equal(0, -0)` passes, `deepStrictEqual(NaN, -0)`
 *   fails); strict uses `Object.is`;
 * - `assert.deepEqual({ a: undefined }, {})` **fails** (key sets are compared, not filtered), while a symbol key
 *   is ignored by loose and compared by strict;
 * - prototypes are compared only by strict (`class A` vs `class B` with identical fields fails; `Object.create(null)`
 *   vs `{}` fails);
 * - `Buffer.from([1])` vs `new Uint8Array([1])` passes loose and fails strict;
 * - `Map`/`Set` entries are matched unordered, `Date` by time, `RegExp` by source **and** flags, `Error` by
 *   `name` + `message`;
 * - an `arguments` object never equals an array, a boxed `new String("a")` never equals `"a"`;
 * - cyclic graphs compare by pair memoisation, so two self-referential objects are deep-strict-equal.
 *
 * No host operation is used and no value is invented: an unknown combination returns `false`, which is what the
 * assertion then reports.
 */

type Comparable = Record<string | symbol, unknown>

const objectProto = Object.prototype
const propertyIsEnumerable = objectProto.propertyIsEnumerable

function ownEnumerableStringKeys(value: object): string[] {
  return Object.keys(value).filter((key) => propertyIsEnumerable.call(value, key))
}

function ownEnumerableSymbolKeys(value: object): symbol[] {
  return Object.getOwnPropertySymbols(value).filter((key) => propertyIsEnumerable.call(value, key))
}

function isBoxedPrimitive(value: object): boolean {
  const proto = Object.getPrototypeOf(value) as object | null
  return proto === String.prototype || proto === Number.prototype || proto === Boolean.prototype || proto === BigInt.prototype || proto === Symbol.prototype
}

function isArrayLikeArguments(value: object): boolean {
  return Object.prototype.toString.call(value) === "[object Arguments]"
}

/** Node's `==` for the primitive half, with the NaN pair treated equal (measured `equal(NaN, NaN)` passes). */
export function abstractEqual(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return a === b || (Number.isNaN(a) && Number.isNaN(b))
  if (a === null || a === undefined) return b === null || b === undefined
  if (b === null || b === undefined) return a === null || a === undefined
  if (typeof a === "object" || typeof b === "object") return false
  return looseCompare(a, b)
}

/** The `==` Node's loose assertion path falls back to for mixed primitive types (`1` vs `"1"`). */
function looseCompare(a: unknown, b: unknown): boolean {
  const left = a as never
  const right = b as never
  return left == right
}

function strictPrimitiveEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  return typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b)
}

/** A pair already being compared, so a cycle terminates instead of recursing forever. */
type Seen = Array<[left: unknown, right: unknown]>

export function looseEqual(a: unknown, b: unknown): boolean {
  return compare(a, b, false, [])
}

export function strictEqual(a: unknown, b: unknown): boolean {
  return compare(a, b, true, [])
}

function compare(a: unknown, b: unknown, strict: boolean, seen: Seen): boolean {
  if (a === b) return true
  const primitive = typeof a !== "object" || a === null
  const otherPrimitive = typeof b !== "object" || b === null
  if (primitive || otherPrimitive) {
    if (strict) {
      if (primitive && otherPrimitive) return strictPrimitiveEqual(a, b)
      // A boxed primitive never equals its primitive form under strict (measured).
      if (primitive !== otherPrimitive) return false
    }
    if (!strict && primitive && otherPrimitive) return abstractEqual(a, b)
    if (!strict && primitive !== otherPrimitive) return false
    return strictPrimitiveEqual(a, b)
  }

  const left = a as object
  const right = b as object
  if (strict && Object.getPrototypeOf(left) !== Object.getPrototypeOf(right)) return false
  if (isArrayLikeArguments(left) !== isArrayLikeArguments(right)) return false
  if (Array.isArray(left) !== Array.isArray(right)) return false

  for (const [knownLeft, knownRight] of seen) {
    if (knownLeft === left && knownRight === right) return true
  }
  seen.push([left, right])

  try {
    return compareObjects(left, right as Comparable, strict, seen)
  } finally {
    seen.pop()
  }
}

function compareObjects(left: object, right: Comparable, strict: boolean, seen: Seen): boolean {
  if (left instanceof Date || right instanceof Date) {
    return left instanceof Date && right instanceof Date && Object.is(left.getTime(), right.getTime())
  }
  if (left instanceof RegExp || right instanceof RegExp) {
    return left instanceof RegExp && right instanceof RegExp && left.source === right.source && left.flags === right.flags
  }
  if (isBoxedPrimitive(left) || isBoxedPrimitive(right)) {
    if (isBoxedPrimitive(left) !== isBoxedPrimitive(right)) return false
    return compare(unboxPrimitive(left), unboxPrimitive(right), strict, seen)
  }
  if (left instanceof Map || right instanceof Map) {
    return left instanceof Map && right instanceof Map && compareMaps(left, right, strict, seen)
  }
  if (left instanceof Set || right instanceof Set) {
    return left instanceof Set && right instanceof Set && compareSets(left, right, strict, seen)
  }
  if (isByteBacking(left) || isByteBacking(right)) {
    return isByteBacking(left) && isByteBacking(right) && compareBytes(toBytesView(left), toBytesView(right), strict)
  }
  if (left instanceof Error || right instanceof Error) {
    if (!(left instanceof Error) || !(right instanceof Error)) return false
    if (left.name !== right.name || left.message !== right.message) return false
  }

  const leftKeys = ownEnumerableStringKeys(left)
  const rightKeys = ownEnumerableStringKeys(right as object)
  if (leftKeys.length !== rightKeys.length) return false
  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) return false
    if (!compare((left as Comparable)[key], (right as Comparable)[key], strict, seen)) return false
  }

  if (strict) {
    const leftSymbols = ownEnumerableSymbolKeys(left)
    const rightSymbols = ownEnumerableSymbolKeys(right as object)
    if (leftSymbols.length !== rightSymbols.length) return false
    for (const key of leftSymbols) {
      if (!Object.prototype.hasOwnProperty.call(right, key)) return false
      if (!compare((left as Comparable)[key], (right as Comparable)[key], strict, seen)) return false
    }
  }
  return true
}

function unboxPrimitive(value: object): unknown {
  return (value as { valueOf(): unknown }).valueOf()
}

function compareMaps(left: Map<unknown, unknown>, right: Map<unknown, unknown>, strict: boolean, seen: Seen): boolean {
  if (left.size !== right.size) return false
  const unmatched = [...right.entries()]
  for (const [key, value] of left.entries()) {
    const index = unmatched.findIndex(([otherKey, otherValue]) => compare(key, otherKey, strict, seen) && compare(value, otherValue, strict, seen))
    if (index < 0) return false
    unmatched.splice(index, 1)
  }
  return unmatched.length === 0
}

function compareSets(left: Set<unknown>, right: Set<unknown>, strict: boolean, seen: Seen): boolean {
  if (left.size !== right.size) return false
  const unmatched = [...right]
  for (const value of left) {
    const index = unmatched.findIndex((other) => compare(value, other, strict, seen))
    if (index < 0) return false
    unmatched.splice(index, 1)
  }
  return unmatched.length === 0
}

function isByteBacking(value: object): boolean {
  return ArrayBuffer.isView(value) || value instanceof ArrayBuffer
}

function toBytesView(value: object): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
  }
  return new Uint8Array(0)
}

/**
 * Byte-wise compare. Node's loose mode compares the bytes only (so a `Buffer` and a `Uint8Array` of the same
 * content match); strict mode additionally requires the same constructor, which `compareObjects`' prototype
 * check has already settled before reaching here.
 */
function compareBytes(left: Uint8Array, right: Uint8Array, strict: boolean): boolean {
  if (left.length !== right.length) return false
  if (strict && Object.getPrototypeOf(left) !== Object.getPrototypeOf(right)) return false
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) return false
  return true
}
