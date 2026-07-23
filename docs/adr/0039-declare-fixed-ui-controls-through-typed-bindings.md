---
status: accepted
---

# Declare fixed UI controls through typed bindings

Each Native Recipe declares typed Control Bindings from semantic Program controls to the specific inputs of retained Execution Nodes. Generation Profiles supply defaults, constraints, and resource choices for those bindings; the Fixed UI renders only declared controls such as model, sampler, dimensions, LoRA strengths, cache settings, and output options. Other third-party node inputs remain exact recipe or profile data, enter Submission Snapshots unchanged, and can only become editable through an explicit binding and versioned migration. Control Bindings are separate from Binding Manifests, which map imported template graphs.
