/**
 * Fixture: a node that spins without ever yielding, which is the case the engine's interrupt handler
 * exists for (`spikes/quickjs-probe`: `outcome=interrupted` in ~1 ms once the flag is set).
 *
 * `input.spinMs` selects a bounded spin so a test can prove the run *finished* rather than merely
 * not failed; with `input.spinMs` absent the loop is infinite and only a cancel or the wall-clock
 * bound can end it.
 *
 * It is run under a **pure** plan (`createRuntimeExport = "-"`), so it answers *data* and the
 * executor's envelope supplies `{success, message}` — exactly what `node-runner.ts:88-91` did for
 * `PureNodeSpec`. A bundle that answered with a whole result document here would be wrapped again by
 * the runner, and that double wrap is the contract, not a bug to paper over.
 */
export function run(input) {
  const limit = typeof input.spinMs === "number" ? input.spinMs : null;
  const until = limit === null ? null : Date.now() + limit;
  let spins = 0;
  while (limit === null || Date.now() < until) {
    spins += 1;
    if (spins % 100000 === 0 && globalThis.__xrh.call("clock.now", "{}").length < 0) {
      // Unreachable by construction; it keeps the engine from treating the loop body as empty.
      break;
    }
  }
  return { spins };
}
