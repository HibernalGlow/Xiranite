/**
 * The capability projection a third-party frontend plugin is handed instead of the full host API.
 *
 * This is the layer `docs/plugin-architecture.md` §2.4 and §10.1 call 运行期投影, and it exists
 * because the statement it replaces was false: `contract.supportedCapabilities` claimed the host
 * injects only what a node needs while `useNodeHostApi` always injected all nine namespaces. A
 * Module Federation remote runs in the **host's own realm** (MF 2.9.2 ships no sandbox — §6.4), so
 * the only thing standing between a plugin and the whole host is this projection.
 *
 * Three layers, in order, and the projection reports only the last one:
 *   1. declared — what the plugin's manifest says it uses (`FrontendPluginSpec.capabilities`,
 *      today recorded by whoever installs the plugin);
 *   2. granted — that list ∩ `GRANTABLE_FRONTEND_CAPABILITIES`, the host's own ceiling;
 *   3. projected — the frozen object returned here; ungranted namespaces are **absent**, not stubs,
 *      so a plugin cannot probe its way past the ceiling by calling something that lies.
 *
 * Two facts to keep in mind before widening the ceiling:
 *   - `runner` addresses *any* backend node by id, and the host has one bearer token for the whole
 *     process (§10.3.1). It stays out until plugin-scoped credentials exist. `dissolve` moves files.
 *   - `clipboard`/`localFiles` reach OS surfaces and their shape already drifts by platform (§6.6),
 *     which is the "运行时形状漂移" the doc forbids for third parties.
 *
 * `trust: "internal"` is not a bypass invented here: §2.4 keeps built-in trusted nodes on the full
 * `NodeHostApi`, and an internal node loaded as a remote (阶段二) is that case. It is opt-in per
 * registration, never the default.
 */

import type {
  NodeCapabilityId,
  NodeContractCapability,
  NodeHostApi,
  NodeHostCapabilities,
} from "@xiranite/contract"

import type { FrontendPluginSpec } from "./frontendRuntime"

/** The namespaces a third-party frontend plugin may be granted at all. */
export const GRANTABLE_FRONTEND_CAPABILITIES: readonly NodeCapabilityId[] = [
  "contract",
  "state",
  "workspace",
  "config",
  "env",
]

/** Always provided: it is how a plugin learns what it did *not* get. */
const ALWAYS_GRANTED: readonly NodeCapabilityId[] = ["contract"]

/**
 * The host API as a plugin sees it: `contract` plus whichever namespaces survived the grant.
 *
 * Not `NodeHostApi` on purpose — the deprecated top-level aliases (`getData`, `actions`, …) are
 * internal-only (§10.2 第 2 条), and an object that can answer `undefined` for a whole namespace is
 * a different contract from one that always has nine.
 */
export type XiraniteFrontendHost = Pick<NodeHostCapabilities, "contract"> & Partial<NodeHostCapabilities>

/**
 * What a third-party plugin's component is actually handed.
 *
 * `NodeComponentProps` (contract) declares `host: NodeHostApi` because that is the built-in nodes'
 * contract; a remote cannot be typed with it without lying, since the projection omits ungranted
 * namespaces. `localFiles` is the proof the lie had consequences: `ModuleRenderer` passes
 * `nodeHost.localFiles` to a provider, and on a host typed as the full API that dereference looks
 * legitimate while the value is `undefined` for every plugin.
 *
 * Field names mirror `NodeComponentProps` on purpose — the remote's own `default export` is
 * indistinguishable from a built-in entry at this call site otherwise.
 */
export interface FrontendPluginComponentProps {
  compId: string
  host: XiraniteFrontendHost
}

export interface FrontendHostAccess {
  readonly pluginId: string
  readonly trusted: boolean
  readonly granted: readonly NodeCapabilityId[]
  /** Declared but refused because they are outside the ceiling — distinct from "never asked for". */
  readonly refused: readonly NodeCapabilityId[]
}

const ALL_CAPABILITY_IDS: readonly NodeCapabilityId[] = [
  "contract",
  "state",
  "workspace",
  "runner",
  "clipboard",
  "downloads",
  "localFiles",
  "config",
  "env",
]

/**
 * Resolves layer 2: what this registration is actually allowed to touch.
 *
 * Default-deny: a spec without `capabilities` gets `contract` and nothing else, because "we have not
 * asked yet" must not turn into "everything" once the PluginManager lands (§10.1 第 3 条: 声明 → 授权 → 投影).
 */
export function resolveFrontendHostAccess(spec: FrontendPluginSpec): FrontendHostAccess {
  if (spec.trust === "internal") {
    return { pluginId: spec.id, trusted: true, granted: ALL_CAPABILITY_IDS, refused: [] }
  }

  const declared = spec.capabilities ?? []
  const granted = new Set<NodeCapabilityId>(ALWAYS_GRANTED)
  const refusedSet = new Set<NodeCapabilityId>()
  for (const capability of declared) {
    if (!ALL_CAPABILITY_IDS.includes(capability) || !GRANTABLE_FRONTEND_CAPABILITIES.includes(capability)) {
      refusedSet.add(capability)
      continue
    }
    granted.add(capability)
  }

  // Both lists are reported in vocabulary order rather than declaration order: the same set must
  // produce the same string whatever the plugin wrote it in, or the memo cache key and the
  // diagnostics disagree with each other about what the same grant is.
  const ordered = ALL_CAPABILITY_IDS.filter((capability) => granted.has(capability))
  return { pluginId: spec.id, trusted: false, granted: ordered, refused: ALL_CAPABILITY_IDS.filter((capability) => refusedSet.has(capability)) }
}

/**
 * Builds layer 3. Trusted registrations return the host object itself — same identity, so a plugin
 * built like a built-in node keeps the memoisation behaviour §10.2 第 3 条 demands.
 *
 * Memoised on (host, spec): the projection is created inside render, and a plugin that stores `host`
 * in a `useEffect` dependency would re-subscribe every keystroke if we returned a fresh object.
 */
export function projectHostForFrontendPlugin(
  host: NodeHostApi,
  spec: FrontendPluginSpec | undefined,
): XiraniteFrontendHost {
  if (!spec) return host
  const access = resolveFrontendHostAccess(spec)
  if (access.trusted) return host

  const cached = projectionCache.get(host)
  const cacheKey = `${spec.id}:${access.granted.join(",")}`
  if (cached?.key === cacheKey) return cached.projection

  const contract: NodeContractCapability = {
    name: host.contract.name,
    version: host.contract.version,
    supportedCapabilities: access.granted,
    hasCapability: (capability: NodeCapabilityId) => access.granted.includes(capability),
  }

  const projection: XiraniteFrontendHost = { contract }
  const granted = access.granted
  // One line per namespace, no loop-and-cast: a typo has to fail the type check, not silently
  // hand a plugin a namespace nobody granted it.
  if (granted.includes("state")) projection.state = host.state
  if (granted.includes("workspace")) projection.workspace = host.workspace
  if (granted.includes("config")) projection.config = host.config
  if (granted.includes("env")) projection.env = host.env
  Object.freeze(projection)

  projectionCache.set(host, { key: cacheKey, projection })
  return projection
}

const projectionCache = new WeakMap<NodeHostApi, { key: string; projection: XiraniteFrontendHost }>()
