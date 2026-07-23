---
status: accepted
---

# Require binding review before template runs

Template Compilation imports UI Workflow JSON or API Prompt Graph JSON into a preserved original snapshot and normalized API graph, then derives candidate semantic roles using live node definitions and graph connectivity. The Fixed UI requires explicit user confirmation of every required Binding Manifest role before a template becomes runnable. Unknown but connected nodes remain preserved Execution Nodes; ambiguous or missing required roles leave the import as a non-runnable draft. Later template updates attempt only conservative manifest remapping and require renewed review whenever equivalence cannot be proved.
