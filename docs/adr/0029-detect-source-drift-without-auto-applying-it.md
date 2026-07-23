---
status: accepted
---

# Detect source drift without auto-applying it

The backend watches external text files and directories referenced by an open Comfygure project and reports debounced Source Drift with added, removed, and changed entry counts. File-system events never mutate an active Run Revision automatically. The user explicitly applies detected changes to the remaining unsubmitted jobs, which re-reads stable file contents and creates a new revision. Deleted, inaccessible, or partially written sources leave existing frozen jobs intact but block a new revision until the source is removed, restored, or relocated.
