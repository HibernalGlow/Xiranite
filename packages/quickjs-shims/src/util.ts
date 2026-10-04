/**
 * `node:util` — pure TypeScript, no host call.
 *
 * Measured surface inside node closures: `promisify` (the five nodes that `promisify(execFile)`), plus a
 * handful of names bundled npm packages reach for (`inspect`, `types`). A missing named export fails inside
 * someone else's code at build time (esbuild resolves named imports), so this module exports the whole set of
 * names the closures and their bundled packages use; the ones that carry real behaviour are implemented and
 * the rest are `notImplemented` throws.
 *
 * `inspect` is a bounded, deterministic formatter — depth-limited so a cyclic graph cannot hang a run — and is
 * deliberately **not** Node's inspect: no colour, no prototype rendering, no getters. Terminal styling stays
 * with the CLI face, which keeps Node's own `util` (ADR-0074 decision 5). `parseArgs` belongs to that CLI face
 * too and throws here.
 */
import { notImplemented } from "./internal.ts"

const customPromisifyArgs = Symbol.for("nodejs.util.promisify.custom_args")
const promisifyCustom = Symbol.for("nodejs.util.promisify.custom")

type CallbackStyleFunction<TArguments extends unknown[], TResult> = (
  ...args: [...TArguments, callback: (error: Error | null, result: TResult) => void]
) => void

/**
 * Node's `promisify`, including the `customPromisifyArgs` contract: `child_process.execFile` attaches
 * `["stdout","stderr"]` and the nodes that `promisify(execFile)` read the resolved object, not the first
 * argument.
 */
export function promisify<TArguments extends unknown[], TResult>(
  original: CallbackStyleFunction<TArguments, TResult> & { [promisifyCustom]?: (...args: TArguments) => Promise<unknown> },
): (...args: TArguments) => Promise<unknown> {
  if (typeof original !== "function") throw new TypeError(`The 'original' argument must be a function. Received type ${typeof original}`)
  const custom = original[promisifyCustom]
  if (typeof custom === "function") return custom as (...args: TArguments) => Promise<unknown>
  const argumentNames = (original as unknown as { [customPromisifyArgs]?: string[] })[customPromisifyArgs] ?? ["value"]
  return function promisified(this: unknown, ...args: TArguments): Promise<unknown> {
    return new Promise((resolve, reject) => {
      original.call(
        this,
        ...args,
        ((error: Error | null, ...values: unknown[]) => {
          if (error) {
            reject(error)
            return
          }
          if (argumentNames.length <= 1) {
            resolve(values[0])
            return
          }
          const result: Record<string, unknown> = {}
          for (const [index, name] of argumentNames.entries()) result[name] = values[index]
          resolve(result)
        }) as never,
      )
    })
  }
}

/** Node's `callbackify`: the inverse of promisify. Bundled packages use it. */
export function callbackify<TArguments extends unknown[], TResult>(
  fn: (...args: TArguments) => Promise<TResult>,
): (...args: [...TArguments, (error: Error | null, result?: TResult) => void]) => void {
  return (...args) => {
    const callback = args[args.length - 1] as (error: Error | null, result?: TResult) => void
    void fn(...(args.slice(0, -1) as TArguments)).then(
      (result) => callback(null, result),
      (error: unknown) => callback(error instanceof Error ? error : new Error(String(error))),
    )
  }
}

type InspectOptions = { depth?: number; colors?: boolean; showHidden?: boolean; breakLength?: number; maxArrayLength?: number }

/** Deterministic, host-free formatting. `depth` defaults to 2 like Node's. */
export function inspect(value: unknown, options?: InspectOptions): string {
  const maxDepth = options?.depth ?? 2
  const maxArrayLength = options?.maxArrayLength ?? 100
  const seen = new Set<unknown>()

  const format = (input: unknown, depth: number): string => {
    if (input === null) return "null"
    if (input === undefined) return "undefined"
    const type = typeof input
    if (type === "bigint") return `${String(input)}n`
    if (type === "symbol") return String(input)
    if (type === "function") return `[Function ${(input as { name?: string }).name || "anonymous"}]`
    if (type === "string") return JSON.stringify(input)
    if (type === "number") return Object.is(input, -0) ? "-0" : String(input)
    if (type === "boolean") return String(input)
    if (input instanceof Date) return input.toISOString()
    if (input instanceof RegExp) return String(input)
    if (ArrayBuffer.isView(input)) {
      const bytes = Array.from((input as unknown as Uint8Array).subarray(0, 8))
      const name = (input as object).constructor?.name ?? "TypedArray"
      return `${name}(${(input as Uint8Array).byteLength}) [ ${bytes.join(", ")}${(input as Uint8Array).byteLength > 8 ? ", ... more items" : ""} ]`
    }
    if (input instanceof ArrayBuffer) return `ArrayBuffer { byteLength: ${input.byteLength} }`
    if (input instanceof Map) {
      if (depth >= maxDepth) return `Map(${input.size}) { < ... > }`
      const entries = [...input.entries()].map(([key, item]) => `${format(key, depth + 1)} => ${format(item, depth + 1)}`)
      return `Map(${input.size}) { ${entries.join(", ")} }`
    }
    if (input instanceof Set) {
      if (depth >= maxDepth) return `Set(${input.size}) { < ... > }`
      return `Set(${input.size}) { ${[...input].map((item) => format(item, depth + 1)).join(", ")} }`
    }
    if (seen.has(input)) return "[Circular]"
    seen.add(input)
    if (Array.isArray(input)) {
      if (depth >= maxDepth) return "[ < ... > ]"
      const shown = input.slice(0, maxArrayLength).map((item) => format(item, depth + 1))
      if (input.length > maxArrayLength) shown.push(`... ${input.length - maxArrayLength} more items`)
      return `[ ${shown.join(", ")} ]`
    }
    const record = input as Record<string, unknown>
    const keys = Object.keys(record)
    if (keys.length === 0) return "{}"
    if (depth >= maxDepth) return "{ < ... > }"
    const constructorName = (record.constructor as { name?: string } | undefined)?.name
    const prefix = constructorName && constructorName !== "Object" ? `${constructorName} ` : ""
    return `${prefix}{ ${keys.map((key) => `${/^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key)}: ${format(record[key], depth + 1)}`).join(", ")} }`
  }

  return format(value, 0)
}

/** `util.types` — only the checks a bundled package actually needs, each one a plain shape test. */
export const types = {
  isDate: (value: unknown): value is Date => value instanceof Date,
  isPromise: (value: unknown): value is Promise<unknown> =>
    value instanceof Promise || (typeof value === "object" && value !== null && typeof (value as { then?: unknown }).then === "function"),
  isRegExp: (value: unknown): value is RegExp => value instanceof RegExp,
  isNativeError: (value: unknown): value is Error => value instanceof Error,
  isFunction: (value: unknown): value is (...args: unknown[]) => unknown => typeof value === "function",
  isPrimitive: (value: unknown): boolean => value === null || (typeof value !== "object" && typeof value !== "function"),
  isArrayBufferView: (value: unknown): value is ArrayBufferView => ArrayBuffer.isView(value),
  isTypedArray: (value: unknown): boolean => ArrayBuffer.isView(value) && !(value instanceof DataView),
  isDataView: (value: unknown): value is DataView => value instanceof DataView,
  isBuffer: (value: unknown): boolean => value instanceof Uint8Array,
  isUint8Array: (value: unknown): value is Uint8Array => value instanceof Uint8Array,
}

/**
 * `debuglog` is how npm packages gate their chatter. Returning a disabled no-op is not a lie: nothing is
 * written, which is exactly the behaviour of an unset `NODE_DEBUG`, and the realm has no stderr policy to
 * invent. `enabled` stays writable so a caller that toggles it does not crash.
 */
export function debuglog(_section?: string): (() => void) & { enabled: boolean } {
  const logger = (() => {}) as (() => void) & { enabled: boolean }
  logger.enabled = false
  return logger
}

/** `styleText` is the Node 20+ helper. Terminal styling belongs to the CLI face, so it is inert here. */
export function styleText(_style: string, text: unknown): string {
  return String(text)
}

/** argv parsing belongs to the CLI face, which keeps Node's own `util.parseArgs`. */
export const parseArgs: (config?: unknown) => never = notImplemented("util", "parseArgs")

export const deprecate =
  (fn: (...args: unknown[]) => unknown, _message: string): ((...args: unknown[]) => unknown) => fn

export const isDeepEqual = (a: unknown, b: unknown): boolean => inspect(a) === inspect(b)

/** `TextEncoder`/`TextDecoder` are engine globals (quickjs-wpt-sys per ADR-0074 decision 1), not realm code. */
export const TextEncoder: () => never = notImplemented("util", "TextEncoder", "the executor enables quickjs-wpt-sys for the global TextEncoder")
export const TextDecoder: () => never = notImplemented("util", "TextDecoder", "the executor enables quickjs-wpt-sys for the global TextDecoder")

const namespace = { promisify, callbackify, inspect, types, debuglog, styleText, parseArgs, deprecate, isDeepEqual, TextEncoder, TextDecoder }
export default namespace
