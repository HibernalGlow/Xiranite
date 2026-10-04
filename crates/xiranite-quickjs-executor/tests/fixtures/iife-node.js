/**
 * Fixture: the `--format=iife` shape the probe ran (`spikes/quickjs-probe/js/linedup-entry.ts`
 * bundled to an IIFE that assigns `globalThis.__nodeEntry`).
 *
 * It exists for one claim: the executor resolves exports from a global script as well as from an ES
 * module, because the bundles already in this repo were measured in the IIFE shape. `run_export` for
 * this file is `__nodeEntry`, which is a global rather than a module binding.
 *
 * Assigned on `globalThis` deliberately: an IIFE is also *legal module text*, so the executor's first
 * arm accepts it, its namespace is empty, and the entry has to be found on the global object.
 */
globalThis.__nodeEntry = function run(input) {
  const total = (input.values || []).reduce((sum, value) => sum + value, 0);
  // A pure plan answers data; `{success, message}` is the runner's envelope, not the bundle's.
  return { total, kind: "global-script" };
};
