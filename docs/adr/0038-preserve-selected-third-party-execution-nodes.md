---
status: accepted
---

# Preserve selected third-party execution nodes

Comfygure compiles dynamic authoring behavior such as batch expansion, trigger matching, parameter selection, and prompt composition before it submits a Prompt Graph. It does not replace performance- or behavior-critical Execution Nodes merely because core ComfyUI alternatives exist. Native Recipes may therefore require exact selected third-party classes for model loading, caching, LoRA application, sampling, decoding, and saving, including `LayerUtility: SaveImagePlus`; their complete configured parameter blocks are recipe or profile data and are checked through Compatibility Preflight. Template Compilation preserves those nodes and bindings. Missing or incompatible required Execution Nodes block submission with diagnostics rather than causing silent fallback or automatic substitution.
