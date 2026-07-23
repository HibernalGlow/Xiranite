---
status: accepted
---

# Compile pure dynamic composition before submission

Comfygure translates pure dynamic composition nodes such as `ImpactSwitch`, `LazySwitchKJ`, `Switch any`, `JoinStringMulti`, and `CR Text Replace` into deterministic Compile-Time Transforms before a Generation Job is frozen. Nodes whose behavior may change the model's input semantics, including `PromptCleaningMaid` and `AnimaPromptFormatter`, remain retained third-party Execution Nodes until their exact source behavior is ported and verified with golden input/output tests. The compiler never removes a semantic transformer merely because it superficially resembles text manipulation.
