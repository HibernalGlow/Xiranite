---
status: accepted
---

# Resolve triggered LoRAs before graph compilation

Comfygure models per-LoRA Activation Match and Prompt Injection as separate compiler concepts. V1 preserves GlowLoader-compatible matching: aliases split on common Chinese and ASCII separators, case-insensitive substring matching against a selected prompt source, and an empty condition meaning always active. Prompt Injection prefers an explicit output override, then an explicit LoRA trigger value, then the same-name `.trigger.txt` file with blank and comment lines removed; injection text never activates a LoRA by itself. Each Generation Job freezes the ordered active LoRA list, model and CLIP strengths, and merged fixed prompt before Prompt Graph compilation, so no Trigger LoRA Stack node is submitted.
