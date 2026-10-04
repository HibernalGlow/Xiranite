/**
 * The one place that answers "where does this module's entry come from".
 *
 * Before this file the answer was hard-coded: `ModuleRenderer` indexed
 * `packageModules.generated.ts` directly, so every node's entry was baked into the host build. That
 * single lookup is the whole integration surface for frontend plugins — the shape of a
 * `NodeEntry`/`AppNodeEntry` (`packages/contract`) is untouched, only its provenance became
 * pluggable (`docs/plugin-architecture.md` §2.3).
 *
 * Two sources, one contract:
 *   - static: the generated table, which Vite can still split per node;
 *   - dynamic: a Module Federation remote built outside this repository, loaded on first use.
 */

import type { AppNodeEntry, HeadlessNodePackage } from "@xiranite/contract"

import { packageModuleLoaders } from "@/components/modules/packageModules.generated"
import { loadRemoteModule, registeredFrontendPlugins, type FrontendPluginSpec } from "./frontendRuntime"

export type PackageModuleEntry = AppNodeEntry | HeadlessNodePackage
export type PackageModuleLoader = () => Promise<{ default: PackageModuleEntry }>

const staticLoaders = packageModuleLoaders as Readonly<Record<string, PackageModuleLoader>>

/** Which expose carries a plugin's `AppNodeEntry`; matches the example plugin's declaration. */
const ENTRY_EXPOSE = "entry"

const remoteEntries = new Map<string, FrontendPluginSpec>()

/**
 * Declares that `moduleId`'s entry comes from a registered remote instead of the build.
 *
 * Kept separate from `registerFrontendPlugin` because one plugin can contribute several module ids,
 * and because the host must be able to answer "is this loaded?" without importing the MF runtime.
 */
export function bindModuleToFrontendPlugin(moduleId: string, spec: FrontendPluginSpec): void {
  remoteEntries.set(moduleId, spec)
}

/** Every module id whose entry a remote provides, for the workspace palette and for diagnostics. */
export function dynamicModuleIds(): string[] {
  return [...remoteEntries.keys()]
}

/** The registered remotes themselves, so a debug surface can show what is loaded from where. */
export function frontendPluginRegistry(): FrontendPluginSpec[] {
  return registeredFrontendPlugins()
}

/**
 * Resolves the loader for a module id: an explicitly bound remote first, then the static table.
 *
 * The order is the meaning of binding a plugin rather than an implementation detail: `moduleId` is
 * also the node id `ModuleRenderer` hands to `useNodeHostApi` (`ModuleRenderer.tsx:100`), so a plugin
 * that is installed for `dissolvef` has to *be* `dissolvef` — both for where its entry loads from and
 * for which backend plugin its operations address. The generated table stays the fallback for every id
 * nobody bound, which is why an unbound node keeps loading from the build.
 */
export function resolveEntryLoader(moduleId: string): PackageModuleLoader | undefined {
  const spec = remoteEntries.get(moduleId)
  if (spec) {
    return async () => {
      const loaded = await loadRemoteModule<PackageModuleEntry | { default?: PackageModuleEntry }>(
        spec.id,
        ENTRY_EXPOSE,
      )
      // A remote may expose the entry directly or as `default`; normalising here keeps the consumer's
      // `mod.default` contract identical for both sources.
      const entry = (loaded as { default?: PackageModuleEntry }).default ?? (loaded as PackageModuleEntry)
      return { default: entry }
    }
  }

  return staticLoaders[moduleId]
}
