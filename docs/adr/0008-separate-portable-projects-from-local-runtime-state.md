---
status: superseded by ADR-0025
---

# Separate portable projects from local runtime state

Comfygure stores its Program, Binding Manifest, imported API template snapshots, selected Generation Profile, and required overrides in a self-contained, versioned `.comfygure.json` Project Document. Model files and generated media are not embedded. Machine-specific connection settings and paths belong to `[nodes.comfygure]`, Run Records and normalized Result References belong to Xiranite runtime storage, and generated media remains under ComfyUI's configured output storage. Comfygure does not automatically move, rename, copy, delete, or regenerate missing media; workspace snapshots retain only the open document reference and view layout.
