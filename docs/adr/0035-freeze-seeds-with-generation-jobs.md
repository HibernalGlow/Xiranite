---
status: accepted
---

# Freeze seeds with generation jobs

Comfygure defines a Seed Policy in the Program and resolves each Generation Job's concrete seed when its Run Plan is frozen. Fixed uses one seed for all jobs, increment uses the base seed plus job order and is the default, and randomized creates one root seed at run creation then deterministically derives the job seeds. Submitted Prompt Graphs receive only their resolved seed and never rely on ComfyUI `control_after_generate` behavior. A Run Revision retains planned seeds for its unsubmitted jobs unless the user explicitly changes the Seed Policy.
