---
status: accepted
---

# Limit V1 to the proven ANIMA generation loop

Comfygure V1 covers the GlowLoader behaviors actually exercised by the reference ANIMA workflow: text batch expansion, triggered LoRA resolution, typed parameter selection, and backend-owned queue coordination. Batch image loading and saving, VNCCS controls, and LLM nodes remain future Semantic Node extensions rather than V1 migration work. The Program, Compiler Recipe, and Target Adapter boundaries remain extensible so this scope limit does not make the initial fixed UI or ANIMA graph shape authoritative for later workflows.
