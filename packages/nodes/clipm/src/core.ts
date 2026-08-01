import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type {
  ApplyFeedbackCommand,
  AutoTrainingResult,
  CmLabel,
  EnvironmentMigrationResult,
  EnvironmentStatus,
  FeedbackApplyResult,
  FeedbackOrigin,
  FeedbackScanResult,
  ModelActivationResult,
  ModelsResult,
  ReviewItemsResult,
  ReviewResolution,
  ReviewStatus,
  ScoreLibraryResult,
  ScoreOptions,
  TrainingResult,
  WorkScoreLookupResult,
  WorkScoreResult,
} from "./generated/contracts.js"
import type { ClipmCallOptions } from "./mcp-client.js"

export type ClipmAction =
  | "score"
  | "work-get"
  | "feedback-scan"
  | "feedback-apply"
  | "review-list"
  | "review-resolve"
  | "train"
  | "train-auto"
  | "model-list"
  | "model-activate"
  | "model-rollback"
  | "env-status"
  | "env-configure"
  | "env-migrate"

export interface ClipmInput {
  action?: ClipmAction
  path?: string
  scope?: "library" | "work"
  scoreOptions?: ScoreOptions
  workId?: string
  classification?: CmLabel | null
  ranking?: number | null
  source?: FeedbackOrigin
  reviewStatus?: ReviewStatus
  reviewLimit?: number
  reviewId?: string
  resolution?: ReviewResolution
  existingWorkId?: string | null
  includeFailed?: boolean
  bundleVersion?: number
  force?: boolean
  targetRuntimeRoot?: string
  device?: "cuda" | "cpu"
  batchSize?: number
}

export type ClipmActionResult =
  | ScoreLibraryResult
  | WorkScoreResult
  | WorkScoreLookupResult
  | FeedbackScanResult
  | FeedbackApplyResult
  | ReviewItemsResult
  | TrainingResult
  | AutoTrainingResult
  | ModelsResult
  | ModelActivationResult
  | EnvironmentStatus
  | EnvironmentMigrationResult

export interface ClipmData {
  action: ClipmAction
  result: ClipmActionResult
}

export type ClipmResult = NodeRunResult<ClipmData>

export interface ClipmGateway {
  isCancelled?(): boolean
  scoreLibrary(path: string, options?: ScoreOptions, callOptions?: ClipmCallOptions): Promise<ScoreLibraryResult>
  scoreWork(path: string, options?: ScoreOptions, callOptions?: ClipmCallOptions): Promise<WorkScoreResult>
  getWorkScore(path: string, callOptions?: ClipmCallOptions): Promise<WorkScoreLookupResult>
  scanFeedback(path: string, options?: ClipmCallOptions): Promise<FeedbackScanResult>
  applyFeedback(command: ApplyFeedbackCommand, options?: ClipmCallOptions): Promise<FeedbackApplyResult>
  listReviewItems(status?: ReviewStatus, limit?: number, options?: ClipmCallOptions): Promise<ReviewItemsResult>
  resolveReviewItem(command: {
    reviewId: string
    resolution: ReviewResolution
    existingWorkId?: string | null
  }, options?: ClipmCallOptions): Promise<WorkScoreResult>
  trainHeads(command?: Record<string, never>, options?: ClipmCallOptions): Promise<TrainingResult>
  runAutoTraining(batchSize: number, options?: ClipmCallOptions): Promise<AutoTrainingResult>
  listModels(command?: { includeFailed?: boolean }, options?: ClipmCallOptions): Promise<ModelsResult>
  activateModel(command: { bundleVersion: number; force?: boolean }, options?: ClipmCallOptions): Promise<ModelActivationResult>
  rollbackModel(command: { bundleVersion: number }, options?: ClipmCallOptions): Promise<ModelActivationResult>
  environmentStatus(options?: ClipmCallOptions): Promise<EnvironmentStatus>
  configureEnvironment(command: { runtimeRoot: string; device: "cuda" | "cpu" }, options?: ClipmCallOptions): Promise<EnvironmentStatus>
  migrateEnvironment(command: { targetRuntimeRoot: string }, options?: ClipmCallOptions): Promise<EnvironmentMigrationResult>
}

const LONG_TASK_TIMEOUT_MS = 30 * 60 * 1000
const LONG_TASK_TOTAL_TIMEOUT_MS = 24 * 60 * 60 * 1000

export async function runClipm(
  input: ClipmInput,
  gateway: ClipmGateway,
  onEvent: (event: NodeRunEvent) => void = () => {},
  signal?: AbortSignal,
): Promise<ClipmResult> {
  const action = input.action ?? "score"
  const cancellation = createCancellationSignal(gateway.isCancelled, signal)
  try {
    onEvent({ type: "progress", progress: 1, message: actionStartMessage(action) })
    const result = await invokeClipmAction(action, input, gateway, requestOptions(onEvent, cancellation.signal))
    onEvent({ type: "progress", progress: 100, message: actionCompleteMessage(action) })
    return {
      success: true,
      message: summarizeResult(action, result),
      data: { action, result },
    }
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error),
    }
  } finally {
    cancellation.dispose()
  }
}

async function invokeClipmAction(
  action: ClipmAction,
  input: ClipmInput,
  gateway: ClipmGateway,
  options: ClipmCallOptions,
): Promise<ClipmActionResult> {
  switch (action) {
    case "score": {
      const path = requiredText(input.path, "A comic work or library path is required.")
      return input.scope === "work"
        ? gateway.scoreWork(path, input.scoreOptions, options)
        : gateway.scoreLibrary(path, input.scoreOptions, options)
    }
    case "work-get":
      return gateway.getWorkScore(requiredText(input.path, "A comic work path is required."), options)
    case "feedback-scan":
      return gateway.scanFeedback(requiredText(input.path, "A path is required to scan feedback."), options)
    case "feedback-apply": {
      if (input.classification === undefined && input.ranking === undefined) {
        throw new Error("Classification, ranking, or both are required to apply feedback.")
      }
      return gateway.applyFeedback({
        workId: requiredText(input.workId, "A work ID is required to apply feedback."),
        classification: input.classification,
        ranking: input.ranking,
        source: input.source ?? "gui",
      }, options)
    }
    case "review-list":
      return gateway.listReviewItems(input.reviewStatus ?? "pending", integerInRange(input.reviewLimit, 100, 1, 1000), options)
    case "review-resolve":
      return gateway.resolveReviewItem({
        reviewId: requiredText(input.reviewId, "A review ID is required."),
        resolution: requiredValue(input.resolution, "A review resolution is required."),
        existingWorkId: input.existingWorkId,
      }, options)
    case "train":
      return gateway.trainHeads({}, options)
    case "train-auto":
      return gateway.runAutoTraining(integerInRange(input.batchSize, 20, 1, 1000), options)
    case "model-list":
      return gateway.listModels({ includeFailed: input.includeFailed ?? true }, options)
    case "model-activate":
      return gateway.activateModel({
        bundleVersion: requiredPositiveInteger(input.bundleVersion, "A model bundle version is required."),
        force: input.force ?? false,
      }, options)
    case "model-rollback":
      return gateway.rollbackModel({
        bundleVersion: requiredPositiveInteger(input.bundleVersion, "A rollback bundle version is required."),
      }, options)
    case "env-status":
      return gateway.environmentStatus(options)
    case "env-configure":
      return gateway.configureEnvironment({
        runtimeRoot: requiredText(input.targetRuntimeRoot, "A runtime directory is required to configure ClipM."),
        device: requiredValue(input.device, "A ClipM device is required."),
      }, options)
    case "env-migrate":
      return gateway.migrateEnvironment({
        targetRuntimeRoot: requiredText(input.targetRuntimeRoot, "A target runtime directory is required."),
      }, options)
  }
}

function requestOptions(onEvent: (event: NodeRunEvent) => void, signal?: AbortSignal): ClipmCallOptions {
  return {
    signal,
    timeoutMs: LONG_TASK_TIMEOUT_MS,
    maxTotalTimeoutMs: LONG_TASK_TOTAL_TIMEOUT_MS,
    onProgress(progress) {
      const percentage = progress.total && progress.total > 0
        ? Math.round((progress.progress / progress.total) * 98) + 1
        : Math.min(99, Math.max(1, Math.round(progress.progress)))
      onEvent({
        type: "progress",
        progress: Math.min(99, Math.max(1, percentage)),
        message: progress.message ?? "ClipM is working.",
      })
    },
  }
}

function summarizeResult(action: ClipmAction, result: ClipmActionResult): string {
  switch (action) {
    case "score": {
      const scoreResult = result as ScoreLibraryResult | WorkScoreResult
      if ("discoveredWorkCount" in scoreResult) {
        return `CM scored ${scoreResult.succeededWorkCount}/${scoreResult.discoveredWorkCount} work(s) with ${scoreResult.failedWorkCount} failure(s).`
      }
      return `CM synchronized ${scoreResult.label} ${scoreResult.score}: ${scoreResult.path}`
    }
    case "work-get": {
      const lookup = result as WorkScoreLookupResult
      return lookup.work
        ? `CM found ${lookup.work.label} ${lookup.work.score}: ${lookup.path}`
        : `CM found no cached score: ${lookup.path}`
    }
    case "feedback-scan": {
      const feedback = result as FeedbackScanResult
      return `CM imported ${feedback.importedFeedbackCount} correction(s) and synchronized ${feedback.synchronizedWorkCount} work(s).`
    }
    case "feedback-apply": {
      const feedback = result as FeedbackApplyResult
      return `CM updated ${feedback.work.label} ${feedback.work.score}: ${feedback.work.path}`
    }
    case "review-list":
      return `CM found ${(result as ReviewItemsResult).items.length} review item(s).`
    case "review-resolve": {
      const work = result as WorkScoreResult
      return `CM resolved the review item as ${work.label} ${work.score}.`
    }
    case "train": {
      const training = result as TrainingResult
      return `CM training ${training.runId}: classification ${training.classification.status}, ranking ${training.ranking.status}.`
    }
    case "train-auto": {
      const automatic = result as AutoTrainingResult
      return automatic.status === "attempted"
        ? `CM automatic training attempted batch ${automatic.batchId ?? "--"}; ${automatic.pendingWorkCount} work(s) remain.`
        : `CM automatic training is waiting for ${automatic.batchSize - automatic.pendingWorkCount} more corrected work(s).`
    }
    case "model-list": {
      const models = result as ModelsResult
      return `CM found ${models.models.length} model bundle(s); active v${models.activeBundleVersion ?? "--"}.`
    }
    case "model-activate":
    case "model-rollback": {
      const activation = result as ModelActivationResult
      return `CM activated model bundle v${activation.activeBundleVersion}.`
    }
    case "env-status":
      return (result as EnvironmentStatus).healthy ? "CM environment is healthy." : "CM environment needs attention."
    case "env-configure":
      return `CM configured and validated its runtime at ${(result as EnvironmentStatus).runtimeRoot}.`
    case "env-migrate": {
      const migration = result as EnvironmentMigrationResult
      return `CM migrated its runtime to ${migration.targetRuntimeRoot}.`
    }
  }
}

function actionStartMessage(action: ClipmAction): string {
  return `Starting CM ${action.replaceAll("-", " ")}.`
}

function actionCompleteMessage(action: ClipmAction): string {
  return `Completed CM ${action.replaceAll("-", " ")}.`
}

function requiredText(value: string | undefined, message: string): string {
  const normalized = value?.trim()
  if (!normalized) throw new Error(message)
  return normalized
}

function requiredValue<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message)
  return value
}

function requiredPositiveInteger(value: number | undefined, message: string): number {
  if (!Number.isInteger(value) || (value ?? 0) < 1) throw new Error(message)
  return value as number
}

function integerInRange(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Expected an integer from ${minimum} to ${maximum}.`)
  }
  return value
}

function createCancellationSignal(
  isCancelled: (() => boolean) | undefined,
  sourceSignal: AbortSignal | undefined,
): { signal: AbortSignal | undefined; dispose(): void } {
  if (!isCancelled) return { signal: sourceSignal, dispose: () => undefined }
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (sourceSignal?.aborted || isCancelled()) abort()
  else sourceSignal?.addEventListener("abort", abort, { once: true })
  const timer = setInterval(() => {
    if (isCancelled()) abort()
  }, 100)
  return {
    signal: controller.signal,
    dispose() {
      clearInterval(timer)
      sourceSignal?.removeEventListener("abort", abort)
    },
  }
}
