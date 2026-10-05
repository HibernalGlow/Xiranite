/**
 * `@xiranite/plugin-sdk` — the public, versioned surface a third-party Xiranite frontend plugin may
 * import (`docs/plugin-architecture.md` §12).
 *
 * Why this exists instead of letting a plugin import host internals: measured over
 * `src/nodes/**` non-test files, the dominant shared dependency is the internal
 * `@/components/ui` tree (hundreds of import sites), while `react` and `@xiranite/contract` are small
 * by comparison. A plugin that imports either the internal UI tree or a copy of the host's types
 * picks one of two bad outcomes — `@/components/ui` silently becomes public API (one refactor breaks
 * every plugin), or the plugin ships its own copy (visual drift plus a second React-sized bundle).
 * So out-of-repo plugins import exactly this package, and the design-token layer that would replace
 * `@/components/ui` for them is `@xiranite/ui`, which is **not** part of this package and is not
 * landed yet (§12's other half).
 *
 * What deliberately is *not* here:
 * - **No capability ceiling.** Which namespaces a plugin may be granted is the host's policy
 *   (`GRANTABLE_FRONTEND_CAPABILITIES` in `src/plugins/frontendHost.ts`). Re-declaring it here would
 *   create a second reader of the same rule, which is the failure mode this document already records
 *   twice (the generated module table, the contract version comparison).
 * - **No copy of the host object shapes.** `PluginHostSurface` is derived from
 *   `@xiranite/contract`'s `NodeHostCapabilities`, so a namespace rename breaks the SDK at compile
 *   time instead of drifting quietly.
 * - **No second RPC client.** The operations a plugin can reach already arrive through the projected
 *   host's own namespaces (`contract`, `runner`, …) over the `/operations` family. A standalone client
 *   is only needed to talk to a host from outside the WebView, and re-exporting
 *   `@xiranite/api/operationsClient` for that would drag its Node-side dependency closure into a
 *   third-party browser bundle. That is a real cost with no current consumer, so it is not done here;
 *   if it lands, it lands as a subpath export and an entry in `abi.test.ts`.
 *
 * Versioning: this is an ABI, so it changes with the plugin-facing frontend API version the host
 * publishes (`src/plugins/frontendApi.ts`, checked against a manifest's `required_api`). Breaking the
 * names below means bumping that number, not adding a deprecated alias.
 *
 * Out-of-repo consumption is wired and measured (2026-10-05): `scripts/vendor-dts.mjs` runs after
 * `tsc` and rewrites every `@xiranite/*` specifier in the emitted declarations into a vendored copy
 * under `dist/vendor/`, so the published artifact carries no workspace specifier. It had to, because
 * contract's own dependencies are `workspace:*` — resolvable here, fatal on a consumer: `file:` gave
 * `error: @xiranite/contract@workspace:* failed to resolve`, `link:` gave
 * `FileNotFound: failed linking dependency/workspace`. Mature bundlers were tried first and are
 * unusable on this repository: TypeScript is 7.0.2 and `require("typescript").sys` is `undefined`,
 * which is exactly what `dts-bundle-generator` dereferences on its first line.
 *
 * Two consequences a reader should not trip over:
 * - `zod` stays a bare specifier and is therefore a real dependency of this package (shared's
 *   declarations import it). The rule is two-sided: workspace packages are vendored, third-party
 *   packages are declared.
 * - `@xiranite/contract` is absent from this package's manifest entirely. Declaring it even as a
 *   devDependency still broke installs, because bun resolves a `file:` dependency's devDependencies
 *   too. The build-time need is enforced by the vendor script (ENOENT on a missing
 *   `packages/contract/dist`) and by the freshness hashes in `src/abi.test.ts`, not by a published
 *   dependency.
 */

import type { AppNodeEntry, NodeCapabilityId, NodeHostCapabilities } from "@xiranite/contract"
import type { ReactNode } from "react"

/**
 * The capability vocabulary, exactly as the contract defines it. Re-exported rather than restated:
 * there is one list of namespaces in the repository and it is not this file's to copy.
 */
export type PluginCapabilityId = NodeCapabilityId

/**
 * What a third-party plugin actually receives.
 *
 * `contract` is always present (a plugin that cannot read the contract cannot negotiate its own
 * requirements); everything else is optional because the host grants it per install, default-deny.
 * The optionality is structural, not decorative — reading `host.runner` without a grant is a type
 * error, which is what makes 默认拒绝 visible at compile time rather than only in the console.
 */
export type PluginHostSurface = Pick<NodeHostCapabilities, "contract"> & Partial<NodeHostCapabilities>

/**
 * Contribution kinds with a real consumer in the host today.
 *
 * The list is closed on purpose: `tray` and `window` contributions exist for built-in nodes, and
 * `route` has no consumer at all (there is no URL router in this app), so declaring one is a
 * documented-but-dead field — the same mistake as `allowed_paths` on the retired backend. A kind
 * joins this list only together with the code that reads it.
 */
export const PLUGIN_CONTRIBUTION_KINDS = ["component"] as const

export type PluginContributionKind = (typeof PLUGIN_CONTRIBUTION_KINDS)[number]

/**
 * The shape a plugin's exposed `./entry` module must export — the same object an internal node's
 * `entry.ts` exports (§2.3: MF2 changes *where* a NodeEntry is loaded from, never *how* it is written).
 *
 * It is an alias of `@xiranite/contract`'s `AppNodeEntry`, vendored into this package's declarations,
 * so the repository keeps one definition of the entry shape. Two consequences worth knowing:
 * - `core` is optional here (a frontend-only plugin has no in-process implementation and must not
 *   fabricate one), while `Component` and `def` are required;
 * - this package deliberately ships **no** runtime validator for it. The host's loader is the only
 *   place that rejects a malformed entry; a second validator here would drift from it.
 */
/**
 * The props a plugin's component receives. This is where §2.4's projection becomes visible to an
 * author: the host hands a **projected** `XiraniteFrontendHost`, while `@xiranite/contract`'s
 * `NodeComponentProps` types `host` as the full `NodeHostApi` (the internal, trusted shape). A plugin
 * written against that promise would compile and then find `host.workspace` undefined at runtime, so
 * the plugin-facing props type is declared here rather than inherited.
 */
export interface PluginComponentProps {
  compId: string
  host: PluginHostSurface
}

/**
 * A plugin's component, as a JSX-usable type.
 *
 * `NodeComponent` returns `unknown` (contract keeps its types framework-free, which is why its `.d.ts`
 * never mentions react). That is fine for the host, which casts at `ModuleRenderer.tsx:178`, but an
 * out-of-repo author writing `<entry.Component …>` gets `'Component' cannot be used as a JSX component
 * . Type 'unknown' is not assignable to type 'ReactNode'` — measured here. Since this package exists
 * specifically for react remotes, it states the react return type, with react as a **peer** dependency
 * (declaring it as a dependency is how you get a second React copy).
 */
export type PluginComponent = (props: PluginComponentProps) => ReactNode

/**
 * The shape a plugin's exposed `./entry` module exports, with the two fields a third-party remote
 * actually has to get right.
 *
 * Same fields as `AppNodeEntry` (`def` required, `core` optional so a frontend-only plugin does not
 * fabricate one), except `Component`, which is typed against the projected host and a react return.
 * Deliberately no runtime validator here: the host's loader is the only place that rejects a
 * malformed entry, and a second validator would drift from it.
 */
export type PluginNodeEntry = Omit<AppNodeEntry, "Component"> & { Component: PluginComponent }

/** A component this plugin adds to the host's module library. */
export interface ComponentContribution {
  kind: "component"
  /** Module id. Built-in ids are legal and mean "replace this node's entry source", not "add a row". */
  id: string
  /**
   * Which of the remote's exposes carries this component (`"./Panel"`, spelled as in §2.1's manifest).
   *
   * Omit it for a single-component plugin: the host then uses its `entry` convention. Declare it for
   * every further component, because without it the row is listed in the module library while the
   * loader has no way to know which module to fetch (`dynamicEntries.exposeOfModule`).
   */
  module?: string
  name?: string
  version?: string
  category?: string
  description?: string
  icon?: string
}

export type PluginContribution = ComponentContribution

/**
 * Builds a component contribution descriptor.
 *
 * The builder exists so the `kind` tag is written by this package rather than by every plugin: the
 * host's validator refuses any other kind, and hand-typed tags are exactly the place where a plugin
 * ships `kind: "panel"` and silently gets a note instead of a module.
 */
export function componentContribution(
  input: string | (Omit<ComponentContribution, "kind"> & { kind?: never }),
): ComponentContribution {
  if (typeof input === "string") return { kind: "component", id: input }
  const { kind: _ignored, ...rest } = input
  return { kind: "component", ...rest }
}
