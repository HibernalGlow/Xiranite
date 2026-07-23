---
status: accepted
---

# Layout canvas exports as semantic compound graphs

Comfygure will construct a deterministic compound layout plan whose groups represent compiler semantics such as model and LoRA loading, conditioning, controls and latent inputs, sampling, and decoding and output. ELK.js will place nodes, route edges, and size nested group regions within that plan; Comfygure will then translate the result into ComfyUI node positions and official group bounding boxes. Hand-authored per-profile coordinates are not the primary layout mechanism. The same layout plan may later project into React Flow, while deterministic ordering, non-overlap, containment, spacing, and edge-crossing checks remain renderer-independent acceptance requirements.
