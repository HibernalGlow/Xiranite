/**
 * The `assert` npm package (installed under the alias `node-assert`) ships no types. This declares the members
 * `assert.ts` re-exports so the shim compiles without implicit-any; the shapes are loose on purpose — the real
 * contract is Node's, and the port is upstream's, not ours.
 */
declare module "node-assert" {
  export class AssertionError extends Error {
    constructor(options?: unknown)
  }
  export type AssertFn = (...args: unknown[]) => void
  export const ok: AssertFn
  export const equal: AssertFn
  export const notEqual: AssertFn
  export const strictEqual: AssertFn
  export const notStrictEqual: AssertFn
  export const deepEqual: AssertFn
  export const notDeepEqual: AssertFn
  export const deepStrictEqual: AssertFn
  export const notDeepStrictEqual: AssertFn
  export const throws: AssertFn
  export const doesNotThrow: AssertFn
  export const rejects: AssertFn
  export const doesNotReject: AssertFn
  export const match: AssertFn
  export const doesNotMatch: AssertFn
  export const fail: AssertFn
  export const ifError: AssertFn
  export const strict: AssertFn & { deepStrictEqual: AssertFn }
  const assert: AssertFn
  export default assert
}
