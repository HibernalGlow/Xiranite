/**
 * Fixture: a platform node in the `PlatformNodeSpec` shape — `createRuntime()` plus
 * `run(input, runtime, onEvent)` returning a `NodeRunResult`-shaped document.
 *
 * It exercises the four things the contract actually promises:
 *   1. `__xrh.call` (synchronous host operation),
 *   2. `__xrh.callAsync` (a parked promise the pump has to settle),
 *   3. `onEvent` forwarding into the operation's event stream,
 *   4. the injected `NodeRunControl` triple, read the way `node-runner.ts:97-99` injected it.
 *
 * `input.mode` selects which of them runs, so one fixture proves several claims without making any
 * single assertion depend on the others.
 */
export function createRuntime() {
  // The platform object is built from the host's own answers, never from `process.*`.
  return {
    name: "fixture-platform",
    cwd: globalThis.__xrh.platform.cwd,
    separator: globalThis.__xrh.platform.sep,
    // A field of its own, so the test can prove the control keys were *added* to a real object.
    marker: "kept",
  };
}

export async function run(input, runtime, onEvent) {
  runtime.checkMemory();
  if (runtime.isCancelled()) {
    return { success: false, message: "cancelled before starting" };
  }
  onEvent({ type: "progress", message: "fixture: listing", progress: 10 });

  const listed = JSON.parse(await globalThis.__xrh.callAsync("fs.list", JSON.stringify({ path: input.root })));
  onEvent({ type: "log", message: "fixture: found " + listed.entries.length + " entries" });

  const read = listed.entries[0]
    ? JSON.parse(await globalThis.__xrh.callAsync("fs.readText", JSON.stringify({ path: listed.entries[0].path })))
    : { content: null };

  await runtime.waitWhilePaused();
  runtime.checkMemory();

  const target = input.root + (globalThis.__xrh.platform.sep === "\\" ? "\\" : "/") + "summary.txt";
  // The synchronous arm, in the same run, so both call shapes are proven against the same grant.
  const written = JSON.parse(globalThis.__xrh.call("fs.writeText", JSON.stringify({
    path: target,
    content: read.content === null ? "empty" : read.content,
  })));

  onEvent({ type: "progress", message: "fixture: done", progress: 100 });
  return {
    success: true,
    message: "fixture platform run",
    data: {
      entries: listed.entries.map((entry) => entry.name),
      content: read.content,
      writtenTo: written.path,
      runtimeName: runtime.name,
      runtimeMarker: runtime.marker,
      hostCwd: runtime.cwd,
      clock: globalThis.__xrh.now(),
      controlKeys: ["isCancelled", "waitWhilePaused", "checkMemory"].filter((key) => typeof runtime[key] === "function"),
    },
  };
}
