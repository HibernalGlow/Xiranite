import type {
  CmLabel,
  EnvironmentStatus,
  EnvironmentMigrationResult,
  FeedbackApplyResult,
  FeedbackScanResult,
  ModelsResult,
  ReviewItem,
  ReviewResolution,
  ScoreLibraryResult,
  TrainingResult,
  WorkScoreResult,
} from "@xiranite/node-clipm/contracts"

export type ClipmWorkspaceView = "scoring" | "corrections" | "training" | "models"
export type ClipmPhase = "idle" | "running" | "completed" | "error"

export interface ClipmCardState {
  activeView?: ClipmWorkspaceView
  path?: string
  scoreScope?: "library" | "work"
  rescore?: boolean
  rename?: boolean
  writeMetadata?: boolean
  dryRun?: boolean
  phase?: ClipmPhase
  busyAction?: string | null
  progress?: number
  progressText?: string
  scoreResult?: ScoreLibraryResult | WorkScoreResult | null
  feedbackScan?: FeedbackScanResult | null
  feedbackApply?: FeedbackApplyResult | null
  feedbackWorkId?: string
  feedbackClassification?: CmLabel
  feedbackRanking?: number
  reviewItems?: ReviewItem[]
  reviewStatus?: "pending" | "resolved"
  reviewResolution?: ReviewResolution
  reviewExistingWorkId?: string
  selectedReviewId?: string
  forceImmediate?: boolean
  trainingResult?: TrainingResult | null
  modelsResult?: ModelsResult | null
  environmentStatus?: EnvironmentStatus | null
  environmentMigration?: EnvironmentMigrationResult | null
  forceActivation?: boolean
  logs?: string[]
}
