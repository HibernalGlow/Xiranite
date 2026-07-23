---
status: accepted
---

# Normalize UI and API workflow imports

V1 accepts both ComfyUI UI-workflow JSON and API Prompt Graph JSON. API graphs are normalized directly; UI workflows are converted with live `/object_info` evidence for widget ordering and node definitions while handling links, bypasses, reroutes, subgraphs, dynamic inputs, frontend-only fields, and unreachable nodes. The Project Document retains the original import snapshot and normalized API graph, but Binding Manifests, Compatibility Preflight, and execution operate only on the normalized graph. Conversion fails closed with node-level diagnostics when a faithful result cannot be established.
