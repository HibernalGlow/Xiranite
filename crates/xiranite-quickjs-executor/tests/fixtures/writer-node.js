/**
 * Fixture: a pure bundle whose one job is to touch the machine.
 *
 * It exists so a *refusal to start* can be told apart from a *refusal to deliver*: a run that was
 * stopped after the bundle had already written leaves the file behind, and a run the executor refused
 * before it evaluated anything does not. `tests/cancel_pause.rs` asserts exactly that difference,
 * which is the claim a cancelled operation must not schedule a node's work.
 *
 * Pure, on purpose: no `createRuntime`, so no `NodeRunControl` triple, and `__xrh` answers no
 * checkpoint operation — the bundle cannot yield to the host by itself, which is why the executor owes
 * the host a read before it evaluates anything.
 */
export function run(input) {
  const written = JSON.parse(
    globalThis.__xrh.call("fs.writeText", JSON.stringify({ path: input.target, content: "scheduled\n" })),
  );
  return { target: written.path };
}
