---
status: accepted
---

# Pin projects to exact compiler recipes

Each Project Document will identify an exact Compiler Recipe ID and version, and Comfygure updates will not silently move existing projects to a newer implementation. Supported historical recipe implementations remain available for deterministic recompilation; a missing recipe blocks compilation instead of falling back. Recipe Migration is an explicit operation that previews semantic, Prompt Graph, and live compatibility differences before changing the project. Run Records capture the exact recipe and profile versions, compiler build identity, and Prompt Graph hash so past executions remain attributable even after later migrations.
