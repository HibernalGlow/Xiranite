import { createUnifiedDiff } from "@xiranite/node-marku/core"
import type { MarkuWorkflow, MarkuWorkflowRunData, MarkuWorkflowStepResult } from "@xiranite/node-marku/core"
import { parseDiff } from "react-diff-view"
import type { ChangeData } from "react-diff-view"

export interface WorkflowNodeDiffLine {
  content: string
  newLineNumber?: number
  oldLineNumber?: number
  type: "delete" | "insert" | "normal"
}

export interface WorkflowNodeResultProjection {
  changedSourceCount: number
  diffLines: WorkflowNodeDiffLine[]
  errorSourceCount: number
  result?: MarkuWorkflowStepResult
  sourceCount: number
  sourceId: string
  sourceLabel: string
  stepId: string
}

/** Maps one completed run back onto the current ordered graph definition. */
export function projectWorkflowRunToNodes(
  workflow: MarkuWorkflow,
  run: MarkuWorkflowRunData | null | undefined,
  selectedSourceId: string,
): Map<string, WorkflowNodeResultProjection> {
  const projections = new Map<string, WorkflowNodeResultProjection>()
  if (!run || run.workflowId !== workflow.id || !run.sources.length) return projections

  const selectedSource = run.sources.find((source) => source.sourceId === selectedSourceId) ?? run.sources[0]!
  const resultsBySource = run.sources.map((source) => new Map(source.steps.map((step) => [step.stepId, step])))
  const selectedResults = new Map(selectedSource.steps.map((step) => [step.stepId, step]))

  for (const step of workflow.steps) {
    const result = selectedResults.get(step.id)
    projections.set(step.id, {
      changedSourceCount: resultsBySource.filter((results) => results.get(step.id)?.changed).length,
      diffLines: result?.changed && !result.error ? parseStepDiff(result) : [],
      errorSourceCount: resultsBySource.filter((results) => Boolean(results.get(step.id)?.error)).length,
      result,
      sourceCount: run.sources.length,
      sourceId: selectedSource.sourceId,
      sourceLabel: selectedSource.sourceLabel,
      stepId: step.id,
    })
  }
  return projections
}

function parseStepDiff(result: MarkuWorkflowStepResult): WorkflowNodeDiffLine[] {
  const patch = createUnifiedDiff(result.inputText, result.outputText, "step.md")
  const changes = parseDiff(patch, { nearbySequences: "zip" }).flatMap((file) => file.hunks.flatMap((hunk) => hunk.changes))
  return changes.map(toDiffLine)
}

function toDiffLine(change: ChangeData): WorkflowNodeDiffLine {
  if (change.type === "delete") {
    return { content: change.content, oldLineNumber: change.lineNumber, type: change.type }
  }
  if (change.type === "insert") {
    return { content: change.content, newLineNumber: change.lineNumber, type: change.type }
  }
  return {
    content: change.content,
    newLineNumber: change.newLineNumber,
    oldLineNumber: change.oldLineNumber,
    type: change.type,
  }
}
