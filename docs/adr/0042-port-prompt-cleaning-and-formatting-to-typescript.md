---
status: accepted
---

# Port prompt cleaning and formatting to TypeScript

V1 ports `PromptCleaningMaid` and `AnimaPromptFormatter` from their local Python source into deterministic TypeScript Compile-Time Transforms. The compiler applies their configured behavior before Generation Jobs freeze, so neither class appears in submitted Prompt Graphs. The Python implementations remain test oracles: a generated fixture corpus, including LoRA tags, weighted tags, escaped brackets, malformed regional syntax, mixed newlines, and Unicode punctuation, must produce byte-identical output before the TypeScript port replaces the nodes. Recipe and Profile data own the cleaner settings; the Fixed UI exposes only declared settings through Control Bindings.
