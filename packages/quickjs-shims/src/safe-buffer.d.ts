/**
 * `safe-buffer` ships no types. Only the two members `string-decoder.ts` calls are declared, and they are loose
 * on purpose: the point of importing them from here (rather than from `./buffer.ts`) is that upstream
 * `string_decoder` reaches its `Buffer` through this same module, so the class used for normalisation is the one
 * the decoder's internals accept in **both** runtimes — aliased to our shim inside the realm, Node's builtin
 * inside Vitest.
 */
declare module "safe-buffer" {
  export const Buffer: {
    isBuffer(value: unknown): boolean
    from(value: string | ArrayLike<number> | ArrayBufferView, encodingOrOffset?: unknown, length?: unknown): unknown
  }
}
