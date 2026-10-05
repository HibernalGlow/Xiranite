/**
 * `node:module` (and the bare `module`) — `createRequire` exists and refuses at call time; the resolver does not.
 *
 * Why it exists: four retained nodes (`bandia`, `cleanf`, `enginev`, `smartzip`) keep
 * `import { createRequire } from "module"` in their platform closures. Two distinct callers:
 *
 * - `fflate` does `const require2 = createRequire("/"); try { require2("worker_threads") } catch {}` — the
 *   `createRequire` call itself is **not** guarded, only the `require` it returns. So this shim must hand
 *   back a function and refuse when *that* is called, or it breaks module init instead of a probe;
 * - `@xiranite/czkawka-native` does `createRequire(import.meta.url)(bindingPath)` to load a native addon. The
 *   realm cannot dlopen anything, and trash/restore is a host service anyway (ADR-0064), so refusing here is
 *   the honest outcome the node's own error handling was written for.
 *
 * The realm resolves modules at **build time** (esbuild `--alias`), never at run time, so `builtinModules`
 * is empty and `isBuiltin` answers false: a runtime specifier is exactly what this environment cannot serve.
 */
import { QuickJsShimError, SHIM_ERROR_CODES } from "./host.ts"
import { notImplemented, notImplementedClass } from "./internal.ts"

type RequireFunction = (specifier: string) => never

export function createRequire(filename: string | URL): RequireFunction {
  return (specifier: string): never => {
    throw new QuickJsShimError(
      SHIM_ERROR_CODES.memberUnsupported,
      `quickjs-shim: module.createRequire(...)(${JSON.stringify(specifier)}) is not implemented`,
      { module: "module", member: "createRequire", specifier, from: String(filename) },
    )
  }
}

export const builtinModules: string[] = []

export function isBuiltin(specifier: string): false {
  void specifier
  return false
}

export const Module: new (...args: unknown[]) => never = notImplementedClass("module", "Module")
export const _resolveFilename: (...args: unknown[]) => never = notImplemented("module", "_resolveFilename")
export const _load: (...args: unknown[]) => never = notImplemented("module", "_load")
export const syncBuiltinESMExports: (...args: unknown[]) => never = notImplemented("module", "syncBuiltinESMExports")
export const register: (...args: unknown[]) => never = notImplemented("module", "register")
export const registerHooks: (...args: unknown[]) => never = notImplemented("module", "registerHooks")
export const wrap: (...args: unknown[]) => never = notImplemented("module", "wrap")
export const createRequireFromPath: (...args: unknown[]) => never = notImplemented("module", "createRequireFromPath")

export default {
  createRequire,
  builtinModules,
  isBuiltin,
  Module,
}
