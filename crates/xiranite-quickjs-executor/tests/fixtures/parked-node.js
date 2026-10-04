/**
 * Fixture: a node that awaits a promise nothing will ever settle.
 *
 * The probe measured the engine fact this stands on: `state=Pending`, no jobs pending, cancel flag
 * set, nothing happens — a parked await cannot be interrupted, so the *host* has to stop waiting.
 * The claim under test is that the executor stops and says why, instead of hanging the operation.
 */
export async function run(input) {
  await new Promise(() => {});
  return { success: true, message: "unreachable", data: {} };
}
