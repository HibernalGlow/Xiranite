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
 * Known blocker for out-of-repo consumption, measured rather than assumed (2026-10-05, recorded in
 * `docs/plugin-architecture.md` §12): the emitted `dist/index.d.ts` carries
 * `import type … from "@xiranite/contract"`, and contract's own dependencies are written
 * `workspace:*`. Installing this package from outside the root workspace therefore fails —
 * `file:` resolves to `error: @xiranite/contract@workspace:* failed to resolve`, and `link:` to
 * `FileNotFound: failed linking dependency/workspace`. Do not wire an external consumer until the
 * declarations are **bundled** (drop the external specifier from the artifact); that is the chosen
 * fix, ahead of changing `workspace:*` repository-wide or hand-copying host shapes back in.
 */

import type { NodeCapabilityId, NodeHostCapabilities } from "@xiranite/contract"

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

/** A component this plugin adds to the host's module library. */
export interface ComponentContribution {
  kind: "component"
  /** Module id. Built-in ids are legal and mean "replace this node's entry source", not "add a row". */
  id: string
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
