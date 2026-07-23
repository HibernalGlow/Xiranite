# Comfygure

Comfygure turns high-level image-generation intent into concrete work for a ComfyUI execution target while keeping authoring concepts separate from ComfyUI's runtime graph format.

## Language

**Comfygure Program**:
A versioned generation definition composed of configurable nodes and their relationships. A program may produce one or many generation jobs.
_Avoid_: ComfyUI workflow, canvas

**Project Document**:
A versioned `.comfygure.json` representation containing the complete compilation semantics of a Comfygure Program, its bindings, imported template snapshots, and Resolved Profile Snapshot. It excludes machine target configuration, model files, runtime state, and generated media.
_Avoid_: Runtime state, local configuration

**Generation Job**:
One fully resolved set of prompts, LoRAs, and generation parameters produced after all dynamic choices and batch expansion have completed.
_Avoid_: Batch item, queue item

**Run Plan**:
An immutable, ordered set of Generation Jobs resolved when a run begins. Prompt Graph compilation and submission may remain lazy without changing the plan.
_Avoid_: Live batch, ComfyUI queue

**Run Revision**:
An immutable replacement for the unsubmitted tail of an active Run Plan, created when the user explicitly applies edited program inputs to remaining work. Submitted jobs retain the revision that produced them.
_Avoid_: Mutable run, live prompt patch

**Source Drift**:
A detected difference between an external project input such as a text file or folder and the content frozen in the current draft or Run Revision. Drift is informational until explicitly applied.
_Avoid_: Live reload, automatic run mutation

**Run Coordinator**:
The backend-owned service that advances a Run Plan, submits owned jobs through a Target Adapter, persists transitions, and reconciles unfinished work independently of any open UI.
_Avoid_: React runner, page session, queue worker

**Run Record**:
The persisted lifecycle state of a Run Plan, including job status, owned prompt IDs, diagnostics, and result references used for recovery and reconciliation.
_Avoid_: Queue snapshot, generation history

**Submission Snapshot**:
The immutable Prompt Graph, graph hash, target capability fingerprint, and submission identity persisted for a Generation Job when it is sent to ComfyUI.
_Avoid_: Current workflow, project copy

**Content Blob**:
A content-addressed, integrity-checked compressed payload used to store large text or JSON once and reference it from projects, plans, revisions, and submission evidence.
_Avoid_: Job text copy, opaque cache

**Result Reference**:
A normalized record that links a completed Generation Job to media written by ComfyUI and captures enough file identity and execution provenance to detect missing results. It indexes media without owning or embedding it.
_Avoid_: Managed output, image copy

**Prompt Graph**:
The concrete ComfyUI API-format graph compiled for one generation job. Its values are fixed before submission to ComfyUI.
_Avoid_: Workflow JSON, source workflow

**Canvas Export**:
An optional, human-readable ComfyUI UI-format projection of a compiled Prompt Graph with deterministic layout and semantic groups. It supports inspection and emergency editing but never becomes an execution or authoring authority.
_Avoid_: Source workflow, execution graph, canonical canvas

**Comfygure Compiler**:
The component that expands a Comfygure Program into generation jobs and emits a Prompt Graph for each job.
_Avoid_: Workflow runner, JSON patcher

**Compiler Recipe**:
A versioned, deterministic native-compilation strategy that maps resolved generation intent and a Generation Profile to semantic node roles, concrete ComfyUI classes, inputs, and connections.
_Avoid_: Auto-generated workflow, model preset

**Recipe Migration**:
An explicit, reviewable transition of a Project Document from one exact Compiler Recipe version to another, including compiled-graph and compatibility differences before acceptance.
_Avoid_: Automatic upgrade, version fallback

**Node Descriptor**:
A data-defined declaration of a concrete ComfyUI node class, its expected fields and ports, and the semantic role it fulfills within a Compiler Recipe.
_Avoid_: Node instance, object-info response

**Native Compilation**:
Prompt Graph generation from Semantic Nodes and Generation Profiles without an imported ComfyUI graph template.
_Avoid_: Default workflow, generated template

**Template Compilation**:
Prompt Graph generation from an imported ComfyUI API graph plus explicit semantic bindings. It extends coverage without making raw ComfyUI nodes part of the Comfygure Program.
_Avoid_: Workflow editing, JSON patching

**Binding Manifest**:
A versioned mapping from stable Comfygure roles to inputs in an imported API graph, confirmed during import and remapped conservatively when the graph changes.
_Avoid_: Node ID map, field patch list

**Compatibility Preflight**:
A capability check that compares compiler expectations and bindings with the connected ComfyUI server before a Prompt Graph may be submitted.
_Avoid_: Runtime retry, best-effort validation

**ComfyUI Target**:
A manually started, locally installed, externally owned ComfyUI execution endpoint paired with its shared Library path. Comfygure only attaches to and inspects a running target without owning its installation or process.
_Avoid_: Managed ComfyUI, embedded runtime

**Target Adapter**:
The replaceable boundary through which Comfygure inspects, submits to, and reconciles with a ComfyUI Target. It exposes Comfygure operations without leaking a transport library into the compiler or program model.
_Avoid_: ComfyUI client, backend wrapper

**Semantic Node**:
A program node that expresses generation intent such as prompt sourcing, batch expansion, LoRA selection, or generation settings without exposing a ComfyUI execution node.
_Avoid_: ComfyUI node, raw node

**Execution Node**:
A concrete ComfyUI node class retained in a Prompt Graph because its loader, sampler, decoder, output, or other runtime behavior is part of the selected generation pipeline. An Execution Node may be third-party and is never automatically replaced merely because a core-node alternative exists.
_Avoid_: Compile-time control, interchangeable implementation, UI-only node

**Control Binding**:
A typed declaration in a Native Recipe that maps one semantic Program control to one or more allowed inputs of retained Execution Nodes. It governs what the Fixed UI may edit and is distinct from a Binding Manifest for an imported template graph.
_Avoid_: Raw node inspector, widget index, template binding

**Compile-Time Transform**:
A deterministic selection, text-composition, or parameter-resolution operation executed by the Comfygure Compiler before a Generation Job is frozen. It is removed from the submitted Prompt Graph while preserving its tested semantic result.
_Avoid_: Execution node, live graph switch, runtime text helper

**Prompt Normalization Pipeline**:
A shared configurable Compile-Time Transform that applies the migrated cleanup and formatting rules to a specific prompt section or final channel while preserving that channel's declared stage order. It produces fixed text for `CLIPTextEncode` inputs.
_Avoid_: Separate cleaner nodes, generic replace chain, one-size-fits-all prompt rewrite

**Generation Profile**:
A versioned, data-defined description of a model's fixed components, compatible generation settings, and recommended defaults. A profile permits validated local overrides without embedding compiler code or exposing its underlying ComfyUI nodes.
_Avoid_: Model preset, workflow template

**Profile Library**:
The local catalog of versioned Generation Profiles available to a Comfygure installation. It contains built-in read-only profiles and user-owned local profile files, while Project Documents retain only resolved snapshots and project-level overrides.
_Avoid_: Runtime database, target configuration, project dependency

**Resource Requirement**:
An exact ComfyUI-reported resource name required by a Generation Profile or Generation Job, such as a model, text encoder, VAE, ControlNet, or LoRA.
_Avoid_: File search, fuzzy model reference

**Activation Match**:
The per-LoRA condition evaluated against selected resolved prompt text to decide whether that LoRA belongs to a Generation Job.
_Avoid_: Trigger words, LoRA prompt

**Prompt Injection**:
The prompt terms contributed by an active LoRA after Activation Match succeeds, sourced from an explicit override or the LoRA's companion trigger file and ensured in the final positive prompt without duplication.
_Avoid_: Activation condition, automatic LoRA selection

**Parameter Variant**:
A named, typed option that atomically resolves a coherent bundle of related generation values before a Run Plan is frozen. Legacy numeric slot selections may be imported into variants but are not authoritative program semantics.
_Avoid_: Dynamic output, slot index, parameter preset

**Seed Policy**:
The declared rule that resolves one concrete seed for every Generation Job as a Run Plan is frozen. It supports fixed, incrementing, and run-randomized generation without relying on mutable ComfyUI widget behavior.
_Avoid_: Control after generate, live random seed, sampler state

**Output Naming Template**:
A Project Document rule that renders a safe, concrete ComfyUI output prefix for each frozen Generation Job from its declared run, job, source, seed, and model context. It controls names only; ComfyUI remains the owner of the resulting media.
_Avoid_: Output directory manager, image archive, post-generation rename

**Resolved Profile Snapshot**:
The complete, immutable Generation Profile data embedded in a Project Document after all built-in, machine-local, and project overrides have been resolved. Its source identity, exact version, and hash preserve provenance without allowing later local changes to alter the project.
_Avoid_: Profile cache, current machine profile

**Profile Migration**:
An explicit, reviewable replacement of a Project Document's Resolved Profile Snapshot with one produced from a different Generation Profile version.
_Avoid_: Profile refresh, automatic override

**Fixed UI**:
The task-oriented projection that edits the Comfygure Program shapes it understands without exposing a node canvas. It is rendered within the host node's normal geometry and lifecycle, may be a heavy node surface, and preserves unsupported program structures instead of flattening or deleting them. Its visual layout is replaceable and never defines Program, compiler, or coordinator semantics.
_Avoid_: Standalone application, full-page workbench, layout contract, simple UI

**Canvas UI**:
An optional graphical projection of the same authoritative Comfygure Program used by the Fixed UI. It does not own compilation semantics.
_Avoid_: Primary workflow, execution graph

**Heavy Node Projection**:
A node-bounded Comfygure UI projection that opens at ordinary node dimensions and may use denser interaction, virtualized lists, and explicit host-supported fullscreen maximize behavior while remaining subject to the Xiranite workspace node lifecycle, geometry limits, and ownership model. It has no independent routing, browser-window, or application-shell authority.
_Avoid_: Standalone application, unrestricted full-page surface, separate workspace
