---
status: accepted
---

# Export a structured diagnostic ComfyUI canvas

Comfygure will optionally derive a Canvas Export alongside each API Prompt Graph, while the Prompt Graph remains the only execution contract submitted to ComfyUI. The export must be genuinely usable rather than merely loadable: deterministic semantic ordering, readable left-to-right data flow, non-overlapping nodes and groups, stable spacing, meaningful titles and colors, and groups whose bounds correctly contain their nodes are acceptance requirements. The layout and grouping stage is independently testable and uses the official ComfyUI UI-workflow schema; it exists for inspection and emergency editing without making the original ComfyUI editor or its canvas format authoritative for Comfygure.
