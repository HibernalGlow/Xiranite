---
status: accepted
---

# Resolve parameter variants before run freeze

Comfygure replaces workflow-time `GlowDynamicTypedOutputs` behavior with named, typed Parameter Variants that can atomically select related values such as dimensions, prompt weights, LoRA strengths, negative-prompt sections, and sampler defaults. The selected bundle is resolved before the Run Plan is frozen, so submitted Prompt Graphs contain only fixed scalar values. Importers may translate legacy one-based slot indexes into variants for migration, but anonymous indexes are not part of the canonical Comfygure Program model.
