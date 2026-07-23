---
status: accepted
---

# Persist run evidence in xiranite.db

Comfygure will store Run Plans, job transitions, owned ComfyUI prompt IDs, progress, diagnostics, Result References, recovery checkpoints, and immutable Submission Snapshots in Xiranite's runtime database. A Submission Snapshot includes the exact submitted Prompt Graph, its hash, the target capability fingerprint, and submission identity needed for attribution and restart reconciliation. Portable Project Documents remain independent files and are not rewritten for routine execution; generated media remains owned by the configured ComfyUI output directory. Project deletion does not implicitly erase run evidence or media, which require separate explicit cleanup operations.
