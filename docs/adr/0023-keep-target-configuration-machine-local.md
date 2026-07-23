---
status: accepted
---

# Keep target configuration machine-local

The active ComfyUI endpoint and shared Library path are machine-specific settings stored under `[nodes.comfygure]` in `xiranite.config.toml`, with defaults of `http://127.0.0.1:8000` and an unset Library path until configured. Project Documents describe required resources and capabilities without embedding endpoint URLs or absolute local paths. Run Records capture the Target identity, effective endpoint, and capability fingerprint actually used so execution remains diagnosable without making machine configuration portable project state.
