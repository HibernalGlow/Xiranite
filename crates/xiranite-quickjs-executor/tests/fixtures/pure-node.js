/**
 * Fixture: the smallest honest stand-in for a node's compiled bundle.
 *
 * It is written as `esbuild --bundle --format=esm` output looks from the outside — real `export`
 * declarations, no imports left in the graph — and hand-written rather than generated so this crate's
 * tests do not depend on `node_modules`. It stands in for `packages/nodes/<id>/src/core.ts` compiled
 * with the pure-node spec shape (`run(input)` returning data, no platform module).
 *
 * Falsification: if the executor never ran it, the numbers below would be absent rather than right.
 */
export function run(input) {
  const names = Array.isArray(input.names) ? input.names : [];
  const total = names.reduce((sum, name) => sum + name.length, 0);
  return {
    path: input.path,
    items: names.length,
    characters: total,
    // Nothing environment-dependent here on purpose: this fixture is the pure-node path.
    doubled: (input.count || 0) * 2,
  };
}
