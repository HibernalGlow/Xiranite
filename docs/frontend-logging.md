# Frontend logging

Xiranite frontend code uses [`consola`](https://github.com/unjs/consola) through
`src/lib/logger.ts`. The wrapper is framework-neutral and is the only logging
entry point for React components, Svelte migrations, Web Components, and plain
TypeScript modules.

## Enable or disable logging

The default level is `warn`. Choose `silent`, `error`, `warn`, `info`, `debug`,
or `trace` in one of these ways:

- Current URL: add `?log=debug`. A URL value wins for that page load.
- Persisted setting: run `window.__xiraniteLog.setLevel("debug")` in DevTools.
- Reset the persisted setting: run `window.__xiraniteLog.reset()`.
- Inspect the active value: run `window.__xiraniteLog.getLevel()`.

In development, enabled logs are printed through Consola and written as JSONL
to `.tmp/xiranite.log`. Transport is batched and capped at 500 events per page
load so diagnostics cannot become an unbounded workload.

## Component contract

Create one module-level logger with a stable, dot-separated scope:

```ts
import { createLogger } from "@/lib/logger"

const logger = createLogger("neoview.reader-sidebar")
```

Use levels consistently:

- `error`: an operation failed and the component cannot complete the requested action.
- `warn`: the component recovered, fell back, or rejected invalid external state.
- `info`: a low-frequency user-visible workflow changed state.
- `debug`: lifecycle, async boundary, and state-transition evidence used for diagnosis.
- `trace`: short-lived, high-detail investigation. Remove it or reduce it to `debug` before merging.

Log an event name followed by structured context. Use stable identifiers and
durations; pass `Error` objects directly so the reporter retains their stack.

```ts
logger.debug("config.load.begin", { componentId, section })
logger.info("book.opened", { componentId, bookId, durationMs })
logger.error("config.load.failed", { componentId, section, error })
```

Do not log during render, animation frames, pointer movement, progress ticks,
image decode loops, or virtual-list row creation. Do not log secrets, file
contents, tokens, or full configuration payloads. Prefer one log at an async
boundary over logs in every helper it calls.

Components do not need mount/unmount logs by default. Add lifecycle logs only
when ownership, cleanup, duplicate instances, or resource leaks are relevant.
Every component that owns an error boundary or catches an async operation must
log the failure or deliberately return it to a parent that does.

Raw `console.*` calls are legacy-only. Do not add new ones under `src`; migrate
the surrounding module to `createLogger` when modifying an existing call.
