---
status: accepted
---

# Revise only unsubmitted run work

An active run may accept user edits through an explicit "apply to remaining jobs" operation. The Run Coordinator never mutates submitted or executing jobs; it creates a new immutable Run Revision that replaces only the unsubmitted tail after re-reading sources, resolving dynamic choices, and freezing new Generation Jobs. Every job records the revision that produced it, preserving a clear boundary between old and new prompts, LoRAs, and generation settings. A small submission window keeps changes responsive without deleting or rewriting the global ComfyUI queue.
