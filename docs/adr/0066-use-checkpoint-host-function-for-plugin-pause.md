---
status: accepted
---

# Use a checkpoint host function for plugin pause and resume

## Context

Extism exposes cancellation but has no native pause/resume: a running plugin call cannot be frozen from
the host. Xiranite's current pause does not freeze CPU either. The existing path is
`pauseOperation()` setting `phase = paused`, then `waitWhilePaused()` awaiting a promise that is
released on resume. Callers yield at item boundaries and the operation's observable state machine is
`Running | Paused | Cancelled | Completed`, which the HTTP surface (`POST /operations/:id/pause`,
`resume`, `cancel`) and the operation monitor both depend on.

Because the current semantics are cooperative waiting rather than suspension, the same semantics can be
reproduced across the WASM boundary without switching runtimes.

## Decision

Add one small host function to the plugin protocol: `xiranite.checkpoint()`.

- Plugins call it between work items: process file, `checkpoint()`, process file, `checkpoint()`.
- The host implementation inspects the owning operation record: if paused, it waits until resume or
  cancel; if cancelled, it returns a cancellation status the plugin treats as a hard stop; otherwise it
  returns immediately.
- Pause therefore follows the existing chain unchanged: `HTTP pause -> operation paused -> plugin
  checkpoint blocks`. Resume releases the pending checkpoint and the plugin continues from the next
  item.
- Cancellation keeps using Extism's own cancellation as the backstop for a plugin that ignores
  checkpoints, so a misbehaving plugin cannot outlive its operation.
- Progress and history semantics stay as they are: checkpoint is a yield and reporting point, not a
  transaction boundary, and it must not be used to fake "resumable mid-file" behavior the current
  product does not promise.

Host functions defined by this decision and ADR-0063: `xiranite.checkpoint`, `xiranite.emit`,
`xiranite.scheduler.acquire`, and the file family `xiranite.file.open/read/write/move/delete`. Plugins
never touch the filesystem, spawn processes or reach the OS directly (ADR-0063 principle 8), and file
access additionally stays bounded by the Extism manifest's `allowed_paths`, `allowed_hosts`, `memory`
and `timeout` so permissions are enforced in two layers.

Large payloads do not cross the boundary as bytes: calls pass path or handle tokens and the host streams
(ADR-0063 principle 9), otherwise Extism becomes an expensive serialization layer.

## Alternatives considered

### Switch to Wasmtime for pause support

Rejected (ADR-0063 principle 7). The current model is cooperative waiting, so a host function reproduces
it exactly, while a runtime swap would fork the plugin ecosystem, lose Extism's host-function and
manifest story, and buy a suspension capability nothing in the product needs.

### Run each item as a separate plugin call so the host controls pacing

Keeps the host in charge without a new function, but it turns every operation into a host-driven loop,
multiplies call overhead, and pushes item-loop logic out of the plugin, which is the logic a plugin
exists to own. Rejected in favor of one cheap checkpoint call.

### Freeze the plugin isolate

Not available in Extism, and freezing an isolate is not equivalent to the current pause either.

## Consequences

The plugin protocol gains a documented obligation: a batch plugin must checkpoint per item, and an
audit should flag plugins whose entry points never call `xiranite.checkpoint` while processing more than
one item, because those would be unpausable in practice. Pause latency becomes item-length bounded, the
same property the current implementation already has, so the product copy about pause behavior stays
accurate.
