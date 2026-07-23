---
status: accepted
---

# Match local resources by exact ComfyUI name

V1 records model, UNET, CLIP, VAE, ControlNet, LoRA, and similar Resource Requirements using the exact names reported by the configured ComfyUI Target. Compatibility Preflight blocks missing values and presents an explicit replacement selection; accepting a replacement creates a new Resolved Profile Snapshot or project override. Comfygure will not hash model files, fuzzy-match similar names, scan unrelated paths, or silently substitute resources. This favors predictable single-machine behavior and a small implementation surface over cross-machine resource discovery.
