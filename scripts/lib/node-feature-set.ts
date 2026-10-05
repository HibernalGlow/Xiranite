/**
 * Derive the `xiranite-core` cargo features a set of nodes actually asks for.
 *
 * This answers the question the feature plan exists for — "some nodes never need the full capability set,
 * how much does that save?" — with a build input instead of a claim. `bun scripts/build-node-flavor.ts`
 * style consumers pass the node ids they intend to ship and get the feature list to hand `cargo build`.
 *
 * The vocabulary here is *build* vocabulary, defined by the `[features]` block this repo added to
 * `crates/xiranite-core/Cargo.toml`, and nothing in this file grants a node anything: which services a node
 * may call comes from `hostRequirements`/`services` in `docs/xiranite-target-node-manifest.json` and is
 * enforced by `crates/xiranite-quickjs-executor/tests/manifest_services_are_answered.rs`. A feature that no
 * tier implies is therefore a hard refusal, not a silent default — see `uncoveredFeatures()`.
 */

/** The measured tier vocabulary of `packages/tauri-migrate`'s feasibility analyzer. */
export type Tier =
  | "pure-logic"
  | "file-io"
  | "recursive-enumeration"
  | "external-process"
  | "network"
  | "os-native"
  | "no-host-free-answer";

export interface FeatureDecision {
  /** Feature names to pass to `cargo build -p xiranite-core --no-default-features --features …`. */
  features: string[];
  /** Tiers that did contribute features, so a reader can see what the answer is built from. */
  basis: Array<{ tier: string; nodes: string[]; features: string[] }>;
  /**
   * Tiers this table cannot yet translate. Kept as data rather than a guess: `external-process` lives in
   * the executor (`process-wrap`, `notify`), which has no feature gate because that crate's
   * `Cargo.toml`/`lib.rs` carry another lane's uncommitted ADR-0078 migration.
   */
  unmappedTiers: Array<{ tier: string; nodes: string[]; why: string }>;
}

/**
 * The row shape `docs/xiranite-target-node-manifest.json` actually carries. `hostRequirements` is typed as
 * `string[]`, not `Tier[]`, on purpose: a tier the analyzer learns tomorrow must land in `unmappedTiers`
 * (and widen nothing), which is a runtime answer — casting the read straight to `Tier[]` would only move
 * the silence into the type system.
 */
export interface NodeRow {
  id: string;
  hostRequirements: readonly string[] | null;
}

/**
 * Tier → the core features that answer it. Each entry names the module it gates, because the grouping was
 * measured over dependency users, not over tier labels (see docs/migration/host-service-feature-gate.md §9.3).
 */
const TIER_TO_FEATURES: Partial<Record<Tier, Array<{ feature: string; module: string }>>> = {
  "os-native": [
    { feature: "clipboard", module: "clipboard.rs (arboard)" },
    { feature: "system-info", module: "cpu.rs + network.rs (sysinfo)" },
    { feature: "power", module: "power.rs (system_shutdown)" },
    { feature: "known-folders", module: "known_folders.rs (dirs)" },
  ],
  // `trash_service.rs:324` calls `dirs::home_dir()`, so trash drags `dirs` in as well; it is its own
  // feature because a clipboard-only host still must not gain a recycle-bin path.
  "file-io": [{ feature: "trash", module: "trash_service.rs + trash_journal.rs (trash, dirs)" }],
  // Ungated on purpose: filesystem/file_stream/enumeration/config_* are the product's floor, so these
  // tiers ask for nothing beyond what every build already links.
  "pure-logic": [],
  "recursive-enumeration": [],
  "network": [],
  "no-host-free-answer": [],
};

/** Tiers whose capability genuinely lives in the executor, which is not feature-gated yet. */
const EXECUTOR_SIDE_TIERS: Partial<Record<Tier, string>> = {
  "external-process":
    "lives in xiranite-quickjs-executor (process-wrap 10.0.1, notify 8); that crate's Cargo.toml/lib.rs " +
    "carry another lane's uncommitted ADR-0078 migration, so no feature exists to ask for yet",
};

export function featuresForNodes(nodes: readonly NodeRow[]): FeatureDecision {
  const features = new Set<string>();
  const basis = new Map<string, { tier: string; nodes: string[]; features: string[] }>();
  const unmapped = new Map<string, { tier: string; nodes: string[]; why: string }>();

  for (const node of nodes) {
    if (node.hostRequirements === null) {
      // An unaudited retained node is a warning the manifest gate already raises; here it must not
      // silently widen or narrow a build, so it contributes nothing and the caller sees an empty set.
      continue;
    }
    for (const tier of node.hostRequirements) {
      // The cast is the lookup, not a promise: a string the table has never seen misses here and the branch
      // below records it as unmappable instead of quietly widening or narrowing the build.
      const mapped = TIER_TO_FEATURES[tier as Tier];
      if (mapped === undefined) {
        const row: { tier: string; nodes: string[]; why: string } =
          unmapped.get(tier) ?? {
            tier,
            nodes: [],
            why: EXECUTOR_SIDE_TIERS[tier as Tier] ?? `no entry in TIER_TO_FEATURES for tier ${tier}`,
          };
        row.nodes.push(node.id);
        unmapped.set(tier, row);
        continue;
      }
      const added: string[] = [];
      for (const entry of mapped) {
        features.add(entry.feature);
        added.push(entry.feature);
      }
      const basisRow: { tier: string; nodes: string[]; features: string[] } =
        basis.get(tier) ?? { tier, nodes: [], features: added };
      basisRow.nodes.push(node.id);
      basis.set(tier, basisRow);
    }
  }

  return {
    features: [...features].sort(),
    basis: [...basis.values()].sort((left, right) => left.tier.localeCompare(right.tier)),
    unmappedTiers: [...unmapped.values()].sort((left, right) => left.tier.localeCompare(right.tier)),
  };
}

/**
 * Every feature the core declares must be reachable from some tier, or the tier vocabulary has drifted
 * from the build vocabulary. Returns the features nothing asks for — an empty list is the passing answer.
 */
export function uncoveredFeatures(declared: string[], used: string[]): string[] {
  const asked = new Set(used);
  return declared.filter((feature) => !asked.has(feature));
}

/** The `[features]` list as declared in `crates/xiranite-core/Cargo.toml`, read from the file. */
export async function declaredCoreFeatures(cargoTomlPath: string): Promise<string[]> {
  const { readFile } = await import("node:fs/promises");
  const text = await readFile(cargoTomlPath, "utf8");
  const marker = "\n[features]\n";
  const start = text.indexOf(marker);
  if (start < 0) throw new Error(`${cargoTomlPath} declares no [features] section`);
  const rest = text.slice(start + marker.length);
  const end = rest.search(/^\[[A-Za-z]/m);
  const block = end < 0 ? rest : rest.slice(0, end);
  const features: string[] = [];
  for (const line of block.split("\n")) {
    const match = /^([A-Za-z][A-Za-z0-9_-]*)\s*=(?!=)/.exec(line.trim());
    // `default` is the shipping posture, not a capability a node can ask for.
    if (match?.[1] && match[1] !== "default") features.push(match[1]);
  }
  return [...new Set(features)].sort();
}

/**
 * The host engines, keyed by the service name a node declares rather than by whichever node happens to
 * use them. `xiranite-builtin-host` forwards both, and measuring it: compiling `czkawka` out drops 314 of
 * the host graph's 441 crates. So this table is where a 314-crime bloat and a host that refuses its own
 * node get decided. It is derived on purpose — `crates/xiranite-quickjs-executor/tests/manifest_services_are_answered.rs`
 * turns a wrong entry into a build failure, which is the only reason guessing here is not also an option.
 */
export const ENGINE_FEATURES: ReadonlyArray<{ service: string; package: string; feature: string }> = [
  { service: "czkawka", package: "xiranite-builtin-host", feature: "czkawka" },
  { service: "findz", package: "xiranite-builtin-host", feature: "findz" },
]

const engineSpec = (entry: { package: string; feature: string }): string =>
  `${entry.package}/${entry.feature}`

/** Engine features a flavour must keep, derived from the services its nodes actually declare. */
export function keptEngineFeatures(declaredServices: readonly string[]): string[] {
  const declared = new Set(declaredServices)
  return ENGINE_FEATURES.filter((entry) => declared.has(entry.service)).map(engineSpec).sort()
}

/** The complement, spelled for `--features`. Split out so a test can assert both halves at once. */
export function droppedEngineFeatures(declaredServices: readonly string[]): string[] {
  const kept = new Set(keptEngineFeatures(declaredServices))
  return ENGINE_FEATURES.map(engineSpec).filter((spec) => !kept.has(spec)).sort()
}
