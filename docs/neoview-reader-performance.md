# NeoView Reader Performance Incident and Prevention

## Scope

This document records the 2026-07 NeoView Reader unresponsive-window incident. The symptom appeared in browser and desktop hosts, and in both four-edge and swimlane layouts. Those layouts share the Reader image path, so a layout-only or desktop-only diagnosis was ruled out.

## Evidence and Findings

### Confirmed

- During the reported stalls, backend health requests continued to complete, normally in 6-25 ms. Backend restart, port selection, and cache deletion cannot fix a renderer-thread stall.
- The old image predecode path used a hand-written Promise-tail batch scheduler. Fast page turns could retain obsolete batches behind a running `Image.decode()`.
- Chromium does not offer a dependable way to force-cancel a running `Image.decode()`. Decoding full-resolution historical pages after navigation can consume renderer CPU and decoded-image memory long after the user has moved to another page.
- Edge-match background code maintained process-global references to decoded `HTMLImageElement`s. A 6240x4160 RGBA image is about 100 MB, so retaining multiple full-resolution pages is unsafe for a cosmetic background feature. The related cache/decoded-image feature was reverted and edge sampling is disabled.

### Not proven by the original log alone

The debug log contains `event-loop:blocked` observations, including intervals close to 60 seconds. That monitor is based on a 250 ms browser timer. Browsers and WebViews throttle such timers in hidden or unfocused documents, so those lines alone do not prove a 60-second CPU block. The monitor now records `visibilityState` and `focused` with every observation.

The original log did not record predecode queue size, replacements, active decodes, or edge-cache ownership. Therefore it cannot prove that every later multi-minute stall came from the predecode queue. The affected path was a confirmed correctness and resource-risk defect, but any remaining incident must be diagnosed from the new queue lifecycle records instead of assumed to be identical.

## Corrective Design

### Replaceable image work

Reader speculative decode uses `p-queue`, the maintained queue library already used by Xiranite services and terminal image decoding.

- Each Reader preloader owns one `PQueue({ concurrency: 1 })`.
- A new page request calls `queue.clear()` before adding its batch. This removes waiting stale tasks and lets only the newest request start after the one running decode settles.
- The completion path still checks image-map identity and terminal state. `clear()` does not stop a decode already executing in Chromium.
- Development logs record `reader:predecode:queue-cleared`, `reader:predecode:batch-start`, and `reader:predecode:batch-settled` with queue state and page indexes.

### Dynamic background safety

- The edge background mode is retained as a configuration value, but it now falls back to its configured solid color.
- It performs no hidden `Image` decode, canvas color readback, cache lookup, or decoded-image retention.
- Re-enabling page-derived edge color requires a separate performance design and the regression gate below; it must not be restored as an opportunistic preload optimization.

## Prevention Rules

1. Do not implement page-turn, preload, thumbnail, upscale, or background scheduling with Promise tails, recursive `.then()` chains, or unbounded `Promise.all`. Use a maintained queue with an explicit concurrency limit.
2. Classify each task as required or replaceable. Page render is required; adjacent decode, edge sampling, artifact warmup, and thumbnails are replaceable. Navigation must discard waiting replaceable tasks for the old generation.
3. Treat every decoded image as a byte-budgeted resource. State the entry and estimated RGBA-byte limits, assign an owner, and dispose it at the owner boundary. A global decoded-image cache without a session cleanup path is prohibited.
4. Preserve cancellation semantics in code review: queue clearing removes waiting work only. Running non-abortable browser work requires identity or generation guards before it may update state.
5. Backend liveness is not UI responsiveness. A healthy `/status` response cannot establish that the React main thread, image decoder, or WebView compositor is healthy.
6. Do not suggest deleting caches as the first action for a reproducible UI stall. First capture workspace mode, background mode, active/queued decode counts, visible/focused state, page dimensions, and backend latency.

## Required Regression Gate

For Reader changes that touch image delivery, preload, backgrounds, or workspace mounting:

1. Add a focused test where the first `Image.decode()` remains pending while the user requests two later pages. After the first settles, only the newest request may decode.
2. Run the focused NeoView tests with `--maxWorkers=1`, then run `bun run typecheck:app`.
3. In a real Reader session, exercise four-edge and swimlane with edge background enabled. Turn several high-resolution pages quickly, then keep the Reader foregrounded and idle for at least 90 seconds. Verify the current page responds and review the queue lifecycle log.
4. Record test surface, image dimensions, queue limits, and any new decoded-image retention in the change description.

The 90-second idle observation is longer than the original 30-60 second failure window. Image-size, cache, or decode-policy changes require a longer soak when the recorded queue data shows unbounded waiting work or retained decoded images.
