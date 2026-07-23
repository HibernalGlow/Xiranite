---
status: accepted
---

# Isolate the ComfyUI client behind a target adapter

Comfygure will initially use the exact-pinned `@stable-canvas/comfyui-client@1.5.9` package for local ComfyUI REST, WebSocket, queue, history, upload, and progress transport, but only behind a Comfygure-owned Target Adapter. The compiler, Run Plan, Run Record, and UI depend on host-neutral Comfygure contracts rather than the package API. Official ComfyUI ingest types and object-info parsing remain the protocol evidence used for validation, and focused contract tests run against the configured local target. This minimizes hand-written transport code while keeping replacement or upstream drift local to one adapter.
