# Freeze run plans before submission

Comfygure resolves batch sources, dynamic choices, LoRA triggers, seeds, and generation parameters into an immutable Run Plan when a run starts. Prompt Graphs are compiled and submitted lazily under queue backpressure, but later UI edits do not mutate pending jobs, preserving reproducible pause, resume, retry, and result attribution.
