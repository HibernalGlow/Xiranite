---
status: accepted
---

# Render output prefixes with Liquid

Comfygure stores an Output Naming Template in the Project Document and freezes its rendered prefix into each Generation Job. Native Compilation defaults to `comfygure/{{ project }}/{{ run }}/{{ job }}-{{ seed }}`, while Template Compilation preserves imported output-node and filename bindings until the user explicitly migrates them. Rendering uses the exact-pinned `liquidjs@10.27.2` library rather than hand-written token replacement or combination logic; Comfygure supplies only an allowlisted context (`project`, `run`, `job`, `seed`, `model`, and `sourceName`) and validates the rendered result as a safe relative prefix. Images remain in ComfyUI's output tree and are indexed by Result References rather than copied into Xiranite.
