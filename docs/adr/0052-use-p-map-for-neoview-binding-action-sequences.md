---
status: accepted
---

# Use p-map for NeoView binding action sequences

## Context

Each NeoView input binding may run one primary action followed by up to seven ordered actions. The first version needs strict serial execution, stop-on-cancel/failure/unavailable behavior, and single-flight handling while one multi-action binding is running. It does not need parallel branches, arbitrary conditions, retries, or recursive workflow references.

Xiranite already contains two broader tools. `RuleTreeEditor` uses `react-querybuilder` with the shared `json-rules-engine` rule tree; it is appropriate for a future event-driven automation rule editor, but exposing an AND/OR expression tree for a simple follow-up list would add configuration and UI complexity without useful semantics. Full XState would model the lifecycle, but its actor and state-machine surface and bundle cost are disproportionate for this bounded linear workflow.

The NeoView package already depends on `p-map` 4.0.0 and uses it in maintained preload, thumbnail, filesystem, and migration paths. It is MIT licensed, supports concurrency and stop-on-error, has about 8.7 KB of installed package source in the current lockfile, and adds no new dependency or transitive package to this change. Upstream `p-map` remains maintained; Xiranite keeps the existing v4 API here to avoid an unrelated ESM-major migration across current consumers.

## Decision

Use `p-map` with `concurrency: 1` and `stopOnError: true` for bindings that contain follow-up actions. Dynamically import it only on the multi-action path; single-action bindings call the executor directly. NeoView owns the domain result contract (`succeeded`, `cancelled`, `unavailable`, or `failed`), the eight-action limit, stop semantics, and the binding-ID single-flight map.

Store follow-up actions as the optional `followUpActions` array on a concrete binding. A missing field means no follow-up actions, so existing TOML remains valid and is not rewritten merely by loading it. Configuration parsing validates every action ID and limits the array to seven entries. The settings UI places an ordered follow-up editor inside the expanded binding row rather than opening a separate tab.

The deletion adapter may prepare and consume an immediately following `reader.next-book` or `reader.previous-book` action so the source book can be released before it is moved to the Recycle Bin. The sequence still reports both configured steps, but it does not open a second adjacent book after the prepared replacement is active.

## Consequences

- Repeated keyboard events keep the existing cached binding lookup; a multi-action repeat performs one map lookup and reuses the active Promise instead of starting another sequence.
- Cancellation from the shared Radix confirmation dialog becomes an explicit result and stops the sequence.
- Headless binding execution uses the same ordered contract and stops when an action is unsupported on that surface.
- Conditional triggers, simultaneous actions, failure branches, and event-driven automation remain separate future work. If added, they should reuse the shared rule tree and receive a dedicated automation surface rather than expanding this linear binding editor.
- Replacing `p-map` later affects only the sequence runner; binding, TOML, executor outcome, and UI contracts do not expose package types.
