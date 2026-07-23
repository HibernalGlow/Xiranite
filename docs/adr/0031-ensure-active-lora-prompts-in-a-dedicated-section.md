---
status: accepted
---

# Ensure active LoRA prompts in a dedicated section

For each active LoRA, Comfygure applies Prompt Injection with ensure semantics: the resolved injection is added to a dedicated LoRA Trigger section of the final positive prompt only when equivalent content is not already present. The section follows fixed model and quality prefixes and precedes character, action, and scene content. Job preview and Run evidence expose the original source text, active LoRAs, newly injected content, and final fixed prompt separately. This replaces the current API workflow's display-only trigger outputs with an explicit compiler guarantee while preventing duplicate trigger terms.
