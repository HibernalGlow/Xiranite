/**
 * Fixture: the granted-root arm.
 *
 * `__xrh.call("fs.stat")` on a path inside the grant and on one outside it, in the same run. The
 * seam documents a refused path as `exists: false` (the leniency `crates/xiranite-native-host`
 * implements and `crates/xiranite-node-registry/src/host_seam.rs:34` explains), and a node's planner
 * branches on exactly that, so the pair is what a migration agent has to be able to rely on.
 *
 * Run under a pure plan, so the answer is the data object and the envelope is the executor's
 * (`node-runner.ts:90`).
 */
export function run(input) {
  const inside = JSON.parse(globalThis.__xrh.call("fs.stat", JSON.stringify({ path: input.inside })));
  const outside = JSON.parse(globalThis.__xrh.call("fs.stat", JSON.stringify({ path: input.outside })));
  const missing = JSON.parse(globalThis.__xrh.call("fs.stat", JSON.stringify({ path: input.root + "/never-created" })));
  const listedOutsideError = (() => {
    try {
      globalThis.__xrh.call("fs.list", JSON.stringify({ path: input.outside }));
      return null;
    } catch (error) {
      return String(error.message);
    }
  })();
  return {
    insideExists: inside.exists,
    insideIsDirectory: inside.isDirectory,
    outsideExists: outside.exists,
    missingExists: missing.exists,
    // The asymmetry the seam states out loud: a listing has no "missing" answer, so a refusal
    // crosses as a failure the caller can see.
    listedOutsideError,
  };
}
