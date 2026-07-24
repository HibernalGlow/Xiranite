---
status: accepted
---

# Render output prefixes with Liquid

Comfygure stores positive, negative, and Output Naming Templates in the Project Document and freezes their rendered strings into each Generation Job. Native Compilation defaults to `{{ prompt.prefix }}, {{ prompt.positive }}`, `{{ prompt.negative }}`, and `comfygure/{{ project | safe_segment }}/{{ run | safe_segment }}/{{ job }}-{{ seed }}`. Template Compilation preserves imported prompt/output bindings until the user explicitly confirms them.

Rendering uses the exact-pinned `liquidjs@10.27.2` library rather than hand-written token replacement or combination logic. Comfygure supplies an allowlisted, typed context covering project/run/job identity, prompt inputs, batch text and source metadata, active LoRAs, model resources, image dimensions, sampler parameters, and the configured output prefix. Strict variables and filters turn missing or invalid names into compile errors. The compiler resolves active LoRAs before rendering, ensures their injection terms in the final positive prompt, normalizes prompt text, and validates the rendered filename as a safe relative prefix.

The default editor projects simple Liquid output and literal tokens into reorderable tags using the shared `@dnd-kit` Sortable system. Users add variables from the allowlisted palette, drag tags to reorder them, and edit literal separators without typing Liquid syntax. The Source view remains available for control-flow templates that cannot be represented losslessly as a flat tag sequence. Both views persist the same Liquid string, so the visual editor is replaceable and existing project documents remain compatible with future UI redesigns.

Images remain in ComfyUI's output tree and are indexed by Result References rather than copied into Xiranite.
