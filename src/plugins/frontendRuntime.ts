/**
 * The Xiranite frontend plugin runtime: a single Module Federation 2.0 instance owned by the host.
 *
 * Scope of this file (POC): prove that a plugin built **outside this repository** can be registered
 * at runtime and mounted inside the host's own JS realm with the host's React. It deliberately does
 * not implement PluginManager duties (install/update/registry/`.xplugin`) — `docs/plugin-architecture.md`
 * §10.1 defers those on purpose.
 *
 * Two decisions here are load-bearing and come from measured facts, not habit:
 *
 * 1. `createInstance` rather than `init`: the runtime's `init` is documented as reusing and merging
 *    an instance of the same name/version, which is exactly what a host that outlives plugin reloads
 *    must not do accidentally. `createInstance` is the no-build-plugin entry point.
 * 2. Shared dependencies are enumerated per subpath (`react`, `react/jsx-runtime`, `react-dom`,
 *    `react-dom/client`) instead of relying on the trailing-slash prefix form: the prefix form is what
 *    bundler plugins emit for you, and the runtime-only behaviour of prefix keys is on our
 *    not-yet-verified list (`docs/plugin-architecture.md` §14). React 19 splits its internals across
 *    those subpaths, and a plugin that bundles its own `react-dom/client` is the classic
 *    two-React-instances failure, so we name every key the host actually has.
 */

import { createInstance, type ModuleFederationOptions } from "@module-federation/runtime"
import * as reactDomClient from "react-dom/client"
import * as reactJsxRuntime from "react/jsx-runtime"
import * as react from "react"
import * as reactDom from "react-dom"

import { version as reactVersion } from "react"

/** The plugin id a frontend contribution is registered under. */
export interface FrontendPluginSpec {
  id: string
  /** `mf-manifest.json` URL or a direct `remoteEntry.js` URL. */
  entry: string
  /**
   * `module` matches what `@module-federation/vite` emits (native `import()`); `var` is the classic
   * script-tag container and needs no CORS on the serving side.
   */
  entryType: "module" | "var"
}

const frontendPlugins = new Map<string, FrontendPluginSpec>()

/**
 * The host's shared scope. `lib` is a synchronous provider of the module namespace the host already
 * loaded, so a remote that asks for `react` gets this exact instance — that is the whole point of
 * running plugins in the host realm rather than in an iframe.
 */
function hostShared(): ModuleFederationOptions["shared"] {
  const shareConfig = { singleton: true, requiredVersion: `^${reactVersion}`} as const
  const entries: Array<[string, unknown]> = [
    ["react", react],
    ["react-dom", reactDom],
    ["react-dom/client", reactDomClient],
    ["react/jsx-runtime", reactJsxRuntime],
  ]
  return Object.fromEntries(entries.map(([key, value]) => [
    key,
    { name: key, version: reactVersion, shareConfig, lib: () => value },
  ]))
}

let instance: ReturnType<typeof createInstance> | undefined

function runtime() {
  if (!instance) {
    instance = createInstance({ name: "xiranite-host", remotes: [], shared: hostShared() })
  }
  return instance
}

/**
 * Registers a plugin built elsewhere. Lazy by contract: `registerRemotes` only writes the entry into
 * the instance options, so no bytes are fetched until the first `loadRemoteEntry` for that id.
 */
export function registerFrontendPlugin(spec: FrontendPluginSpec): void {
  frontendPlugins.set(spec.id, spec)
  runtime().registerRemotes(
    [{ name: spec.id, alias: spec.id, entry: spec.entry, type: spec.entryType }],
    { force: true },
  )
}

/** The registered plugins, for the debug surface and for the dynamic entry lookup. */
export function registeredFrontendPlugins(): FrontendPluginSpec[] {
  return [...frontendPlugins.values()]
}

/**
 * Loads one exposed module id (`"<pluginId>/<expose>"`, e.g. `poc-frontend/entry`) from a remote that
 * was built outside this repository.
 */
export async function loadRemoteModule<TModule>(remoteId: string, expose: string): Promise<TModule> {
  if (!frontendPlugins.has(remoteId)) {
    throw new Error(`frontend plugin "${remoteId}" is not registered in this host`)
  }
  return (await runtime().loadRemote<TModule>(`${remoteId}/${expose}`)) as TModule
}
