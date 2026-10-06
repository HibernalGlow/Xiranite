/**
 * Fixture: a node that waits on the host's clock, which is the only way a realm can wait at all
 * (ADR-0074 §2 — the realm has no timers; `czkawka_operations.rs:21` records the same measurement).
 *
 * It answers the milliseconds the host says it actually slept, so a test can assert the wait happened
 * and how long it was, instead of asserting that the call did not throw. `input.ms` above the arm's cap
 * is the refusal case, and it is reached through the same door on purpose: the node has no way to tell a
 * bound from a bug, so the wording of the refusal is the only thing it gets.
 */
export function run(input) {
  const waited = Number(globalThis.__xrh.call("clock.sleep", JSON.stringify({ ms: input?.ms ?? 0 })));
  return { waitedMs: waited };
}
