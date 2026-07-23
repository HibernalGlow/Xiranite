---
status: accepted
---

# Optimize projects for single-machine use

Comfygure is designed first for the user's existing local ComfyUI environment rather than cross-machine distribution. Project Documents retain complete compilation semantics to prevent local upgrade drift, while endpoint configuration, Library paths, model files, generated media, and runtime state remain machine-local. V1 will not add environment packaging, model transfer, path remapping, content-hash discovery, or guarantees that a project copied to another machine can execute unchanged. Cross-machine use is best effort when the destination already provides matching resources and capabilities.
