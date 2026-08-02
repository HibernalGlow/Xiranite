import type { ClipmData } from "@xiranite/node-clipm/core"
import type {
  EnvironmentStatus,
  AutoTrainingResult,
  EnvironmentMigrationResult,
  FeedbackApplyResult,
  FeedbackEventsResult,
  FeedbackScanResult,
  ModelsResult,
  PerceptualCalibrationResult,
  PerceptualRecoveryStatus,
  RemoveWorkMetadataResult,
  ReviewItemsResult,
  ScoreLibraryResult,
  TrainingResult,
  WorkScoreResult,
} from "@xiranite/node-clipm/contracts"
import type { ClipmCardState } from "./types"

export function clipmResultPatch(data: ClipmData, currentScoreResult?: ClipmCardState["scoreResult"]): Partial<ClipmCardState> {
  switch (data.action) {
    case "score":
      return { scoreResult: mergeScoreResult(currentScoreResult, data.result as ScoreLibraryResult | WorkScoreResult) }
    case "feedback-scan":
      return { feedbackScan: data.result as FeedbackScanResult }
    case "feedback-apply":
      return { feedbackApply: data.result as FeedbackApplyResult }
    case "feedback-list":
      return { feedbackEvents: (data.result as FeedbackEventsResult).events ?? [] }
    case "feedback-undo":
      return { feedbackApply: data.result as FeedbackApplyResult }
    case "work-remove-metadata":
      return { metadataRemovalResult: data.result as RemoveWorkMetadataResult }
    case "review-list":
      return { reviewItems: (data.result as ReviewItemsResult).items }
    case "review-resolve":
      return { selectedReviewId: undefined }
    case "recovery-status":
      return { recoveryStatus: data.result as PerceptualRecoveryStatus }
    case "recovery-calibrate":
      return { calibrationResult: data.result as PerceptualCalibrationResult }
    case "train":
      return { trainingResult: data.result as TrainingResult }
    case "train-auto":
      return { autoTrainingResult: data.result as AutoTrainingResult }
    case "model-list":
      return { modelsResult: data.result as ModelsResult }
    case "model-activate":
    case "model-rollback":
      return { modelsResult: null }
    case "env-status":
      return { environmentStatus: data.result as EnvironmentStatus }
    case "env-configure":
      return { environmentStatus: data.result as EnvironmentStatus }
    case "env-migrate": {
      const migration = data.result as EnvironmentMigrationResult
      return { environmentMigration: migration, environmentStatus: migration.targetStatus }
    }
  }
}

/** Extracts the private, structured payload attached to a live scoring event. */
export function scoreProgressWork(value: unknown): WorkScoreResult | undefined {
  if (!isRecord(value) || value.kind !== "work-score" || !isRecord(value.work)) return undefined
  const work = value.work
  if (typeof work.workId !== "string" || typeof work.path !== "string") return undefined
  if ((work.label !== "P" && work.label !== "N") || typeof work.score !== "number") return undefined
  return work as unknown as WorkScoreResult
}

/** Merges a persisted work into the visible score table without waiting for the
 * library tool's final aggregate result. */
export function mergeScoreProgress(
  current: ClipmCardState["scoreResult"],
  work: WorkScoreResult,
): ScoreLibraryResult | WorkScoreResult {
  return mergeScoreResult(current, work)
}

/**
 * Merge a completed score snapshot into the card's accumulated view. Separate
 * score operations may target different directories, while a progress event
 * may be an earlier partial snapshot of the same directory. Work IDs and
 * failure paths make both cases idempotent without letting a later response
 * erase results that arrived from another operation.
 */
export function mergeScoreResult(
  current: ClipmCardState["scoreResult"],
  incoming: ScoreLibraryResult | WorkScoreResult,
): ScoreLibraryResult {
  const left = current ? asScoreLibraryResult(current) : undefined
  const right = asScoreLibraryResult(incoming)
  if (!left) return right

  const works = new Map(left.works.map((work) => [work.workId, work]))
  for (const work of right.works) works.set(work.workId, work)
  const failures = new Map(left.failures.map((failure) => [failure.path, failure]))
  for (const failure of right.failures) failures.set(failure.path, failure)
  const mergedWorks = [...works.values()]
  const mergedFailures = [...failures.values()]

  return {
    ...left,
    discoveredWorkCount: mergedWorks.length + mergedFailures.length,
    succeededWorkCount: mergedWorks.length,
    failedWorkCount: mergedFailures.length,
    feedback: left.path === right.path ? right.feedback : left.feedback,
    works: mergedWorks,
    failures: mergedFailures,
  }
}

export function scoreWorks(result: ClipmCardState["scoreResult"]): WorkScoreResult[] {
  if (!result) return []
  const works = "works" in result ? result.works ?? [] : [result]
  return [...works].sort(compareWorkScores)
}

export function scoreFailures(result: ClipmCardState["scoreResult"]) {
  return result && "failures" in result ? result.failures ?? [] : []
}

export function fileName(path: string): string {
  return path.replaceAll("\\", "/").split("/").pop() || path
}

function compareWorkScores(left: WorkScoreResult, right: WorkScoreResult): number {
  return right.score - left.score || left.path.localeCompare(right.path, undefined, { sensitivity: "base" })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asScoreLibraryResult(value: ScoreLibraryResult | WorkScoreResult): ScoreLibraryResult {
  if ("works" in value) {
    return {
      ...value,
      works: value.works ?? [],
      failures: value.failures ?? [],
    }
  }
  const path = value.sourcePath ?? value.path
  return {
    path,
    discoveredWorkCount: 1,
    succeededWorkCount: 1,
    failedWorkCount: 0,
    feedback: {
      path,
      scannedWorkCount: 0,
      synchronizedWorkCount: 0,
      importedFeedbackCount: 0,
    },
    works: [value],
    failures: [],
  }
}
