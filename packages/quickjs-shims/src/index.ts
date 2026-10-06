/**
 * `@xiranite/quickjs-shims` — the `node:` surface a Xiranite node bundle may import inside the QuickJS host.
 *
 * Two jobs, and they are different:
 *
 * 1. **Alias targets.** `scripts/build-node-bundles.ts` rewrites every `node:*` specifier (and the bare
 *    spelling) to a file in this directory via esbuild's `--alias`. That means each module must carry Node's
 *    *named* exports, because esbuild resolves named imports at build time and fails on a missing one — which
 *    is exactly why the modules above export every member (implemented, or a `notImplemented` throw).
 * 2. **Realm globals.** This file is the prelude esbuild `--inject`s into every bundle. It publishes `process`
 *    and `Buffer` as globals, because many closure files read the bare names and a realm has neither. Nothing
 *    here shadows the host's own runtime globals (`console`, `URL`, `performance`): this package does not
 *    define them, so a specifier that should keep working still can.
 *
 * `__xrh` must already be installed when this prelude runs — the executor owns that order. `createProcessShim`
 * reads `__xrh.platform`; outside a realm it falls back to POSIX, so importing this module in the build tooling
 * never throws.
 */
import { Buffer, atob, btoa, kMaxLength, resolveObjectURL, transpile } from "./buffer.ts"
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
 */
export function installShimGlobals(target: typeof globalThis = globalThis): void {
  if (target.process === undefined) target.process = createProcessShim() as unknown as typeof target.process
  if (target.Buffer === undefined) target.Buffer = Buffer as unknown as typeof target.Buffer
}

// The injected prelude installs the globals as a side effect of being evaluated ahead of the bundle body.
installShimGlobals()
