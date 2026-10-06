/**
 * Fixture: a node that waits repeatedly — the shape a countdown or a sampling monitor actually has.
 *
 * One `clock.sleep` call is capped (see `clock-sleep-node.js`), so waiting for longer than a second is a
 * loop of calls. That loop is also the only way the run's wall-clock deadline can ever be seen: the realm's
 * pump reads it between host calls, so this fixture is what makes "a node may declare how long it means to
 * run" a testable claim rather than a field nobody reads.
 */
export function run(input) {
  const rounds = typeof input?.rounds === "number" ? input.rounds : 1;
  const ms = typeof input?.ms === "number" ? input.ms : 50;
  let waited = 0;
  for (let index = 0; index < rounds; index += 1) {
    waited += Number(globalThis.__xrh.call("clock.sleep", JSON.stringify({ ms })));
  }
  return { rounds, waitedMs: waited };
}
