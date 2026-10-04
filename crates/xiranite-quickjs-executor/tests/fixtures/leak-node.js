/**
 * Fixture: a node that allocates past its declared live-byte ceiling.
 *
 * QuickJS turns `set_memory_limit` into a *catchable* `out of memory` (measured in the probe at
 * `elapsed_ms=2`), which is the whole reason ADR-0074 §"Why" counts the engine primitives back as a
 * gain. Whether the node catches it is the node's business; this fixture lets it escape, because the
 * claim under test is that the *run* reports a failure instead of aborting the host process.
 *
 * The `swallow` arm answers data, like every pure-plan bundle: the `{success, message}` envelope is
 * the executor's (`node-runner.ts:90`), so a caught out-of-memory is still a well-formed document.
 */
export function run(input) {
  const kept = [];
  try {
    for (;;) {
      kept.push(new Uint8Array(input.blockBytes || (1024 * 1024)));
    }
  } catch (error) {
    if (input.swallow) {
      return { blocks: kept.length, note: String(error) };
    }
    throw error;
  }
}
