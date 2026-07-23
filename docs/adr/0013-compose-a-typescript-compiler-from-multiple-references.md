---
status: accepted
---

# Compose a TypeScript compiler from multiple references

Comfygure will not fork or migrate one reference application wholesale. Its production React and TypeScript implementation will selectively absorb the strongest proven parts: the typed NodeBuilder, preset resolution, tests, and API/canvas graph generation from `darklordemperor/comfyui-workflow-builder`; the native ANIMA builder and template-injection coverage from `UselessToys/Ecosystem_WebUI`; the HTTP, WebSocket, invocation, and programmable workflow patterns from `StableCanvas/comfyui-client`; and Mooshie's generation behavior and interaction model. Mooshie AST inventories remain migration evidence for features that have no suitable TypeScript source, but they are no longer the production baseline. Every absorbed path must preserve Comfygure's compile-before-submit rule, external ComfyUI Target boundary, live compatibility preflight, and fixed Prompt Graph output.
