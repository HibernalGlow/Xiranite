---
status: accepted
---

# Emit static Comfyroll LoRA stack chains

After Comfygure resolves Activation Matches and strengths, the Native ANIMA Recipe groups the ordered active LoRA list into deterministic three-slot `CR LoRA Stack` Execution Nodes, chains their `LORA_STACK` outputs, and connects the result to `CR Apply LoRA Stack`. `GlowTriggerLoRAStack` is not submitted. With no active LoRAs, the recipe omits the stack and apply nodes and connects the model and CLIP directly to the sampler path. The compiler does not send an undocumented raw Python stack payload through the API graph.
