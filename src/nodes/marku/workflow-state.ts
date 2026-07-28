// Pure workflow card-state transitions and graph projection for the Marku GUI.
// No React and no React Flow imports: the editor maps this plain projection to
// React Flow types so the graph stays a visual projection only (ADR 0056).
import type { MarkuWorkflow, MarkuWorkflowLibrary, MarkuWorkflowStep } from "@xiranite/node-marku/core"
import { clonePlainConfig, createMarkuWorkflowId, normalizeMarkuWorkflow } from "@xiranite/node-marku/core"
import type { MarkuCardState } from "./types"

export interface WorkflowGraphNode {
  id: string
  index: number
  module: string
  selected: boolean
  position: { x: number; y: number }
}

export interface WorkflowGraphEdge {
  id: string
  source: string
  target: string
}

/** Horizontal spacing between projected step nodes; drag reorder rounds against it. */
export const WORKFLOW_NODE_GAP_X = 220
/** Snapped vertical lane so a linear pipeline reads left to right. */
export const WORKFLOW_NODE_Y = 24

/** One-step draft seeded from the current Normal-mode module and parsed config. */
export function createWorkflowDraftFromNormal(module: string, config: Record<string, unknown>): MarkuWorkflow {
  return {
    id: createMarkuWorkflowId(),
    name: "",
    steps: [{ id: createMarkuWorkflowId("step"), module, config: clonePlainConfig(config) }],
  }
}

/**
 * Card patch for switching Normal -> Workflow. An existing draft wins; then the
 * active library workflow is loaded as a fresh editable copy; otherwise a
 * one-step draft is created from the Normal-mode module and config.
 */
export function enterWorkflowMode(
  state: MarkuCardState,
  library: MarkuWorkflowLibrary,
  fallback: { module: string; config: Record<string, unknown> },
): Partial<MarkuCardState> {
  if (state.workflowDraft) {
    return { mode: "workflow", selectedWorkflowStepId: ensureStepSelection(state.workflowDraft, state.selectedWorkflowStepId) }
  }
  const active = state.activeWorkflowId ? library.workflows.find((workflow) => workflow.id === state.activeWorkflowId) : undefined
  if (active) {
    const draft = cloneWorkflow(active)
    return { mode: "workflow", workflowDraft: draft, selectedWorkflowStepId: ensureStepSelection(draft, state.selectedWorkflowStepId) }
  }
  const draft = createWorkflowDraftFromNormal(fallback.module, fallback.config)
  return { mode: "workflow", workflowDraft: draft, activeWorkflowId: "", selectedWorkflowStepId: draft.steps[0]?.id }
}

/** Switching back never touches workflow definitions or the active reference. */
export function exitWorkflowMode(): Partial<MarkuCardState> {
  return { mode: "normal" }
}

/** Loads a library workflow into the card as a fresh editable draft. */
export function activateWorkflow(library: MarkuWorkflowLibrary, workflowId: string): Partial<MarkuCardState> | null {
  const target = library.workflows.find((workflow) => workflow.id === workflowId)
  if (!target) return null
  const draft = cloneWorkflow(target)
  return { activeWorkflowId: target.id, workflowDraft: draft, selectedWorkflowStepId: draft.steps[0]?.id, workflowRun: null }
}

/** Card patch after deleting the active workflow: never a dangling selection. */
export function stateAfterActiveWorkflowDeleted(fallback: { module: string; config: Record<string, unknown> }): Partial<MarkuCardState> {
  const draft = createWorkflowDraftFromNormal(fallback.module, fallback.config)
  return { activeWorkflowId: "", workflowDraft: draft, selectedWorkflowStepId: draft.steps[0]?.id, workflowRun: null }
}

export function renameWorkflow(workflow: MarkuWorkflow, name: string): MarkuWorkflow {
  return { ...workflow, name: name.trim() }
}

export function addWorkflowStep(
  workflow: MarkuWorkflow,
  module: string,
  config: Record<string, unknown> = {},
): { workflow: MarkuWorkflow; stepId: string } {
  const step: MarkuWorkflowStep = { id: createMarkuWorkflowId("step"), module, config: clonePlainConfig(config) }
  return { workflow: { ...workflow, steps: [...workflow.steps, step] }, stepId: step.id }
}

export function removeWorkflowStep(workflow: MarkuWorkflow, stepId: string): MarkuWorkflow {
  return { ...workflow, steps: workflow.steps.filter((step) => step.id !== stepId) }
}

/** Copies a step in place, inserting the clone right after the original. */
export function duplicateWorkflowStep(workflow: MarkuWorkflow, stepId: string): { workflow: MarkuWorkflow; stepId: string } | null {
  const index = workflow.steps.findIndex((step) => step.id === stepId)
  if (index < 0) return null
  const source = workflow.steps[index]!
  const clone: MarkuWorkflowStep = { id: createMarkuWorkflowId("step"), module: source.module, config: clonePlainConfig(source.config) }
  const steps = [...workflow.steps]
  steps.splice(index + 1, 0, clone)
  return { workflow: { ...workflow, steps }, stepId: clone.id }
}

export function moveWorkflowStep(workflow: MarkuWorkflow, stepId: string, targetIndex: number): MarkuWorkflow {
  const from = workflow.steps.findIndex((step) => step.id === stepId)
  if (from < 0) return workflow
  const to = Math.max(0, Math.min(workflow.steps.length - 1, targetIndex))
  if (from === to) return workflow
  const steps = [...workflow.steps]
  const [moved] = steps.splice(from, 1)
  steps.splice(to, 0, moved!)
  return { ...workflow, steps }
}

export function updateWorkflowStepModule(workflow: MarkuWorkflow, stepId: string, module: string): MarkuWorkflow {
  return { ...workflow, steps: workflow.steps.map((step) => (step.id === stepId ? { ...step, module } : step)) }
}

export function updateWorkflowStepConfig(workflow: MarkuWorkflow, stepId: string, config: Record<string, unknown>): MarkuWorkflow {
  return { ...workflow, steps: workflow.steps.map((step) => (step.id === stepId ? { ...step, config: clonePlainConfig(config) } : step)) }
}

/** Inserts or replaces a workflow, keeping the normalized library shape. */
export function upsertWorkflowInLibrary(library: MarkuWorkflowLibrary, workflow: MarkuWorkflow): MarkuWorkflowLibrary {
  const normalized = normalizeMarkuWorkflow(workflow)
  if (!normalized) return library
  const exists = library.workflows.some((item) => item.id === normalized.id)
  return {
    schemaVersion: 1,
    workflows: exists
      ? library.workflows.map((item) => (item.id === normalized.id ? normalized : item))
      : [...library.workflows, normalized],
  }
}

export function removeWorkflowFromLibrary(library: MarkuWorkflowLibrary, workflowId: string): MarkuWorkflowLibrary {
  return { schemaVersion: 1, workflows: library.workflows.filter((workflow) => workflow.id !== workflowId) }
}

export function duplicateWorkflowInLibrary(
  library: MarkuWorkflowLibrary,
  workflowId: string,
): { library: MarkuWorkflowLibrary; workflow: MarkuWorkflow } | null {
  const source = library.workflows.find((workflow) => workflow.id === workflowId)
  if (!source) return null
  const copy: MarkuWorkflow = {
    ...cloneWorkflow(source),
    id: createMarkuWorkflowId(),
    name: source.name ? `${source.name} 副本` : "副本",
  }
  return { library: { schemaVersion: 1, workflows: [...library.workflows, copy] }, workflow: copy }
}

/** Returns a valid step selection, falling back to the first step. */
export function ensureStepSelection(workflow: MarkuWorkflow | null | undefined, selectedStepId: string | undefined): string | undefined {
  if (!workflow?.steps.length) return undefined
  if (selectedStepId && workflow.steps.some((step) => step.id === selectedStepId)) return selectedStepId
  return workflow.steps[0]!.id
}

export function findWorkflowStep(workflow: MarkuWorkflow | null | undefined, stepId: string | undefined): MarkuWorkflowStep | undefined {
  if (!workflow || !stepId) return undefined
  return workflow.steps.find((step) => step.id === stepId)
}

/** Plain linear projection: positions derive from step order and never persist. */
export function projectWorkflowGraph(workflow: MarkuWorkflow, selectedStepId?: string): { nodes: WorkflowGraphNode[]; edges: WorkflowGraphEdge[] } {
  const nodes = workflow.steps.map((step, index) => ({
    id: step.id,
    index,
    module: step.module,
    selected: step.id === selectedStepId,
    position: { x: index * WORKFLOW_NODE_GAP_X, y: WORKFLOW_NODE_Y },
  }))
  const edges: WorkflowGraphEdge[] = []
  for (let index = 0; index + 1 < workflow.steps.length; index += 1) {
    const source = workflow.steps[index]!
    const target = workflow.steps[index + 1]!
    edges.push({ id: `${source.id}->${target.id}`, source: source.id, target: target.id })
  }
  return { nodes, edges }
}

/** Maps a horizontal drag position back to an ordered-step index. */
export function stepIndexForDragPosition(x: number, stepCount: number): number {
  if (stepCount <= 0) return 0
  return Math.max(0, Math.min(stepCount - 1, Math.round(x / WORKFLOW_NODE_GAP_X)))
}

function cloneWorkflow(workflow: MarkuWorkflow): MarkuWorkflow {
  return {
    id: workflow.id,
    name: workflow.name,
    steps: workflow.steps.map((step) => ({ id: step.id, module: step.module, config: clonePlainConfig(step.config) })),
  }
}
