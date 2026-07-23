---
status: accepted
---

# Start native compilation with the reachable ANIMA INT8 chain

The first Native ANIMA Recipe reproduces the reachable execution path in the reference API graph: `OTUNetLoaderW8A8` through `AnimaTeaCache`, deterministic Comfyroll LoRA stack and apply nodes when needed, `FLS_SamplerV4`, `VAEDecode`, and `LayerUtility: SaveImagePlus`, alongside `CLIPLoader`, `VAELoader`, `AnimaLatentImage`, and two `CLIPTextEncode` nodes. Model resources, cache settings, sampling values, LoRA strengths, and output settings are exposed only through declared Profile and Control Bindings. Unconnected `AnimaBoosterLoader`, layer replay, and AuraFlow nodes are excluded from V1 and will require separate explicit Recipes rather than automatic substitution.
