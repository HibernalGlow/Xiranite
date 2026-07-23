# Fail closed on incompatible ComfyUI capabilities

Comfygure runs a Compatibility Preflight against live `/object_info` before submission. Missing node classes, removed required inputs, incompatible types, and invalid connection slots block compilation; additive optional changes produce diagnostics, explicit version adapters may migrate known changes, and unknown structural changes are never submitted speculatively.
