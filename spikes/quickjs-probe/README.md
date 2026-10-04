# QuickJS probe (ADR-0074 spike)

Standalone on purpose: its own workspace root, listed in the repository root's `[workspace] exclude`,
so the question "can we run node cores in QuickJS" never leaks into the product's dependency graph
while ADR-0074 is still `proposed`.

## What it answers

| probe | question | pass looks like |
| --- | --- | --- |
| `smoke` | does `rquickjs` build and run here, and do host calls land? | `outcome=ok` with `host_calls=2` |
| `spin 500` | does `set_interrupt_handler` break a runaway script, and how fast? | `outcome=interrupted`, `elapsed_ms` ≈ the cancel delay |
| `alloc 64` | does `set_memory_limit` fail observably instead of killing the process? | `error=JS exception: out of memory` |
| `bundle <file.js> {}` | does a real node bundle run, with the node's own cases as oracle? | `passed` == the asserted total |

`bindgen` is deliberately **off**: the point of the Windows trip is the pre-generated-binding path
(upstream marks `x86_64-pc-windows-msvc` tested but *experimental*, and `bindgen` is what pulls in
LLVM/Clang).

## Running it (no node_modules needed on the target machine)

```sh
# once, on the machine that has the node sources:
./node_modules/.bin/esbuild spikes/quickjs-probe/js/linedup-entry.ts \
  --bundle --format=iife --outfile=spikes/quickjs-probe/js/linedup.bundle.js

# oracle: the same bundle under the current TS runtime
bun -e 'await import("./spikes/quickjs-probe/js/linedup.bundle.js"); console.log(globalThis.__nodeEntry("{}"))'

# the question: the same bundle under QuickJS
cd spikes/quickjs-probe && cargo run -- bundle js/linedup.bundle.js "{}"
```

Copy `Cargo.toml`, `Cargo.lock`, `src/` and `js/*.bundle.js` to the target machine and run the same
three commands minus esbuild — the bundle is engine-neutral, so no `node_modules` is required there.

## Measured (macOS arm64, rustc 1.98.1, rquickjs 0.14.0, 2026-10-05)

```
probe=smoke  outcome=ok elapsed_ms=1 host_calls=2
probe=spin   outcome=interrupted cancel_after_ms=500 elapsed_ms=501 error=JS exception: interrupted
probe=alloc  outcome=failed-observably limit_mb=64 elapsed_ms=2 error=JS exception: out of memory
probe=bundle outcome=ok elapsed_ms=4 host_calls=0   # linedup: 7/7 asserted cases pass
```

The linedup bundle reports 7/7 under both engines. The one deliberate divergence is the informational
locale case — bun (the current runtime) sorts `["äpfel","apfel","zebra"]`, QuickJS sorts
`["apfel","zebra","äpfel"]`, i.e. plain code-unit order, because QuickJS ships no Intl. That is the
reproduction behind the "locale belongs to the host" boundary in ADR-0074 §2: the node's own test suite
does not catch it, because its cases are ASCII-only.

Windows numbers: **not collected yet** — the box was unreachable when this was written. That is the only
veto in ADR-0074; everything else here is already tunable.
