/**
 * `node:assert` — Node's assertion surface, taken from the `assert` npm package (the browserify port of the
 * same code, MIT). Installed under the alias `node-assert` so this file's own import cannot collide with the
 * esbuild `--alias:assert=<this file>` mapping.
 *
 * Why it exists: `dissolvef` and `comfygure` platform closures `require("assert")` through bundled npm. Assert
 * carries `deepStrictEqual` semantics (prototypes, symbols, cyclic structures) that are a bad hand-port and a
 * perfect re-use.
 *
 * No refusals: the package carries every member Node's module has, `strict` included.
 */
export {
  AssertionError,
  deepEqual,
  deepStrictEqual,
  doesNotMatch,
  doesNotReject,
  doesNotThrow,
  equal,
  fail,
  ifError,
  match,
  notDeepEqual,
  notDeepStrictEqual,
  notEqual,
  notStrictEqual,
  ok,
  rejects,
  strict,
  strictEqual,
  throws,
} from "node-assert"

export { default } from "node-assert"
