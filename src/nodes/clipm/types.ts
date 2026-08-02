import type {
  CmLabel,
  AutoTrainingResult,
  EnvironmentStatus,
  EnvironmentMigrationResult,
  FeedbackApplyResult,
  FeedbackEventRecord,
  FeedbackScanResult,
  ModelsResult,
  PerceptualCalibrationResult,
  PerceptualRecoveryStatus,
  RemoveWorkMetadataResult,
  ReviewItem,
  ReviewResolution,
  ScoreLibraryResult,
  TrainingResult,
  WorkScoreResult,
} from "@xiranite/node-clipm/contracts"

export type ClipmWorkspaceView = "scoring" | "corrections" | "training" | "models" | "tasks"
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
  feedbackEvents?: FeedbackEventRecord[]
  feedbackWorkId?: string
  feedbackClassification?: CmLabel
  feedbackRanking?: number
  metadataRemovalPath?: string
  metadataRemovalResult?: RemoveWorkMetadataResult | null
  reviewItems?: ReviewItem[]
  recoveryStatus?: PerceptualRecoveryStatus | null
  calibrationResult?: PerceptualCalibrationResult | null
  reviewStatus?: "pending" | "resolved"
  reviewResolution?: ReviewResolution
  reviewExistingWorkId?: string
  selectedReviewId?: string
  trainingResult?: TrainingResult | null
  autoTrainingResult?: AutoTrainingResult | null
  modelsResult?: ModelsResult | null
  environmentStatus?: EnvironmentStatus | null
  environmentMigration?: EnvironmentMigrationResult | null
  forceActivation?: boolean
  logs?: string[]
}
