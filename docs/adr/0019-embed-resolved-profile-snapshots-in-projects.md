---
status: accepted
---

# Embed resolved profile snapshots in projects

A Project Document will embed the complete Resolved Profile Snapshot used for compilation together with its source reference, exact version, and content hash. Compilation uses that snapshot rather than re-resolving against the current machine configuration, so copying the project preserves its generation semantics when the required external models and nodes are available. Built-in and machine-local profiles seed new projects and offer explicit Profile Migrations only. A migration previews profile, Prompt Graph, and live compatibility differences before replacing the snapshot; local profile updates never silently alter an existing project.
