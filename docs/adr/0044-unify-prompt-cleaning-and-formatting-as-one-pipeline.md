---
status: accepted
---

# Unify prompt cleaning and formatting as one pipeline

Comfygure implements one TypeScript Prompt Normalization Pipeline rather than separate ports of `PromptCleaningMaid` and `AnimaPromptFormatter`. The pipeline is stage-configured by Recipe or Profile so it preserves the original graph's distinct behaviors: formatting fixed positive prefixes before composition, comprehensive cleaning after positive composition, and simple normalization for negative composition. Golden fixtures use each Python node as the oracle for its matching stage; sharing the implementation must not collapse their different input positions or configured behavior into one indiscriminate rewrite.
