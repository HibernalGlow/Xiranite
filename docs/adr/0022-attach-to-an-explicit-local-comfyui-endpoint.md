---
status: accepted
---

# Attach to an explicit local ComfyUI endpoint

V1 connects only to a configured loopback ComfyUI endpoint, defaulting to `http://127.0.0.1:8000`, and does not scan ports or infer a server from running processes. The backend reconnects automatically, refreshes `/object_info`, and repeats Compatibility Preflight before submitting further jobs. A disconnect pauses jobs that have not been submitted; submitted jobs with unknown state are reconciled through target history and are never automatically resubmitted.
