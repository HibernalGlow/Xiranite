/**
 * `@xiranite/quickjs-shims` — the `node:` surface a Xiranite node bundle may import inside the QuickJS host.
 *
 * Two jobs, and they are different:
 *
 * 1. **Alias targets.** `scripts/build-node-bundles.ts` rewrites every `node:*` specifier (and the bare
 *    spelling) to a file in this directory via esbuild's `--alias`. That means each module must carry Node's
 *    *named* exports, because esbuild resolves named imports at build time and fails on a missing one — which
 *    is exactly why the modules above export every member (implemented, or a `notImplemented` throw).
 * 2. **Realm globals.** This file is the prelude esbuild `--inject`s into every bundle. It publishes `process`,
 *    `Buffer` and Node's `global` alias as globals, because many closure files read the bare names and a realm
 *    has none of them. Nothing here shadows the host's own runtime globals (`console`, `URL`, `performance`):
 *    this package does not define them, so a specifier that should keep working still can.
 *
 * `__xrh` must already be installed when this prelude runs — the executor owns that order. `createProcessShim`
 * reads `__xrh.platform`; outside a realm it falls back to POSIX, so importing this module in the build tooling
 * never throws.
 */
import { Buffer, atob, btoa, kMaxLength, resolveObjectURL, transpile } from "./buffer.ts"
import { createCryptoGlobal } from "./crypto.ts"
import { createProcessShim, type ProcessShim } from "./process.ts"
import { HOST_GLOBAL_KEY, hasHost, QuickJsShimError, SHIM_ERROR_CODES } from "./host.ts"

export { Buffer, atob, btoa, kMaxLength, resolveObjectURL, transpile }
export { createProcessShim, type ProcessShim }
export { HOST_GLOBAL_KEY, hasHost, QuickJsShimError, SHIM_ERROR_CODES }
export { OPERATIONS_V1, OPERATIONS_V2_REQUESTED } from "./host.ts"

/**
 * Publishes the realm globals. Called once at prelude time. In a realm `__xrh` is installed first, so
 * `process` carries the real platform facts; a tool importing this module without a host still gets a POSIX
 * `process` (the shim falls back) and a working `Buffer` (pure data).
 *
 * `global` is Node's own alias for the global object, and a closure file can read it *while the module body
 * runs*: `node_modules/signal-exit/index.js` opens with `var process = global.process`, so a realm without
 * the alias fails to load that bundle at all ("global is not defined") rather than failing one call. It is
 * installed as the same object the other two globals live on, so a bundle cannot get two global objects.
 */
export function installShimGlobals(target: typeof globalThis = globalThis): void {
  const realm = target as typeof globalThis & { global?: typeof globalThis; crypto?: unknown }
  if (target.process === undefined) target.process = createProcessShim() as unknown as typeof target.process
  if (target.Buffer === undefined) target.Buffer = Buffer as unknown as typeof target.Buffer
  if (realm.global === undefined) realm.global = realm
  // Node and the web both expose `crypto` as a global, and `packages/nodes/dissolvef/src/platform.ts:20`
  // reads `crypto.randomUUID()` bare — a realm without it fails the *run*, not the import. The object is
  // the same two host operations the `node:crypto` module uses, so entropy has one source.
  if (realm.crypto === undefined) realm.crypto = createCryptoGlobal() as unknown as typeof realm.crypto
}

// The injected prelude installs the globals as a side effect of being evaluated ahead of the bundle body.
installShimGlobals()
