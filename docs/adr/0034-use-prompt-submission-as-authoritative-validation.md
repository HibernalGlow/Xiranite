---
status: accepted
---

# Use prompt submission as authoritative validation

Before submission, Comfygure validates workflow shape with reused official schemas, enforces stricter Compiler Recipe and graph invariants, and performs live Compatibility Preflight against parsed `/object_info` definitions and exact resources. It then submits the first Generation Job through the public `/prompt` API and treats ComfyUI's response, including node-level validation errors, as the final authority. Comfygure will not import or invoke ComfyUI's internal Python validation path to simulate an unsupported dry run; a valid `/prompt` request therefore becomes the first real queued job, while a rejected request is persisted as structured Run diagnostics.
