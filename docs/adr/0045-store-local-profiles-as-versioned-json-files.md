---
status: accepted
---

# Store local profiles as versioned JSON files

Built-in Generation Profiles ship as read-only Comfygure data. User-owned local Profiles are separate versioned JSON files beneath Xiranite's data directory at `comfygure/profiles/`, with one Profile per file; the Fixed UI creates them by copying a built-in or existing local Profile. `[nodes.comfygure]` in `xiranite.config.toml` contains only machine configuration such as the ComfyUI Target, Library path, optional Profile Library path override, and last-used selections. Project Documents store project overrides plus an immutable Resolved Profile Snapshot, so later local profile edits never silently change a project or run.
