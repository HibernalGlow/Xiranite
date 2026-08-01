import type { ClipmData } from "@xiranite/node-clipm/core"
import type {
  EnvironmentStatus,
  AutoTrainingResult,
  EnvironmentMigrationResult,
  FeedbackApplyResult,
  FeedbackScanResult,
  ModelsResult,
  ReviewItemsResult,
  ScoreLibraryResult,
  TrainingResult,
  WorkScoreResult,
} from "@xiranite/node-clipm/contracts"
import type { ClipmCardState } from "./types"

export function clipmResultPatch(data: ClipmData): Partial<ClipmCardState> {
  switch (data.action) {
    case "score":
      return { scoreResult: data.result as ScoreLibraryResult | WorkScoreResult }
    case "feedback-scan":
      return { feedbackScan: data.result as FeedbackScanResult }
    case "feedback-apply":
      return { feedbackApply: data.result as FeedbackApplyResult }
    case "review-list":
      return { reviewItems: (data.result as ReviewItemsResult).items }
    case "review-resolve":
      return { selectedReviewId: undefined }
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

export function scoreWorks(result: ClipmCardState["scoreResult"]): WorkScoreResult[] {
  if (!result) return []
  return "works" in result ? result.works ?? [] : [result]
}

export function scoreFailures(result: ClipmCardState["scoreResult"]) {
  return result && "failures" in result ? result.failures ?? [] : []
}

export function fileName(path: string): string {
  return path.replaceAll("\\", "/").split("/").pop() || path
}
