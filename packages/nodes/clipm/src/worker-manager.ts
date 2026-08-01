import type {
  ActivateModelCommand,
  AutoTrainingResult,
  ApplyFeedbackCommand,
  EnvironmentMigrationResult,
  EnvironmentStatus,
  FeedbackApplyResult,
  FeedbackEventsResult,
  FeedbackScanResult,
  ListFeedbackEventsCommand,
  ListModelsCommand,
  MigrateEnvironmentCommand,
  ModelActivationResult,
  ModelsResult,
  PerceptualRecoveryStatus,
  ResolveReviewItemCommand,
  RemoveWorkMetadataResult,
  RollbackModelCommand,
  ReviewItemsResult,
  ReviewStatus,
  ScoreOptions,
  ScoreLibraryResult,
  TrainHeadsCommand,
  TrainingResult,
    WorkScoreLookupResult,
    UndoFeedbackCommand,
  WorkScoreResult,
} from "./generated/contracts.js"
import {
  createClipmMcpConnection,
  type ClipmCallOptions,
  type ClipmCallResult,
  type ClipmMcpConnection,
  type ClipmMcpConnectionOptions,
} from "./mcp-client.js"

export interface ClipmWorkerLease {
  readonly owner: string
  readonly pid: number | null
  callTool(name: string, args?: Record<string, unknown>, options?: ClipmCallOptions): Promise<ClipmCallResult>
  release(): Promise<void>
}

export interface ClipmWorkerSnapshot {
  state: "stopped" | "starting" | "running" | "stopping" | "disposed"
  leaseCount: number
  owners: string[]
  pid: number | null
}

export interface ClipmWorkerManagerOptions extends ClipmMcpConnectionOptions {
  createConnection?(options: ClipmMcpConnectionOptions): Promise<ClipmMcpConnection>
  autoTrain?: boolean
  autoTrainBatchSize?: number
}

export class ClipmWorkerManager {
  readonly #options: ClipmWorkerManagerOptions
  readonly #leases = new Map<symbol, string>()
  #connection: ClipmMcpConnection | undefined
  #starting: Promise<ClipmMcpConnection> | undefined
  #stopping: Promise<void> | undefined
  #disposed = false

  constructor(options: ClipmWorkerManagerOptions) {
    this.#options = options
  }

  snapshot(): ClipmWorkerSnapshot {
    return {
      state: this.#disposed ? "disposed" : this.#stopping ? "stopping" : this.#connection ? "running" : this.#starting ? "starting" : "stopped",
      leaseCount: this.#leases.size,
      owners: [...this.#leases.values()],
      pid: this.#connection?.pid ?? null,
    }
  }

  async acquire(owner: string): Promise<ClipmWorkerLease> {
    if (this.#disposed) throw new Error("ClipM worker manager is disposed.")
    if (!owner.trim()) throw new Error("ClipM worker leases require an owner.")
    const token = Symbol(owner)
    this.#leases.set(token, owner)
    let connection: ClipmMcpConnection
    try {
      connection = await this.#ensureConnection()
    } catch (error) {
      this.#leases.delete(token)
      throw error
    }
    let released = false
    return {
      owner,
      get pid() { return connection.pid },
      callTool: (name, args, options) => connection.callTool(name, args, options),
      release: async () => {
        if (released) return
        released = true
        this.#leases.delete(token)
        if (this.#leases.size === 0) await this.#stopConnection()
      },
    }
  }

  async callStructured<T extends object>(
    name: string,
    args: Record<string, unknown> = {},
    options?: ClipmCallOptions,
  ): Promise<T> {
    const lease = await this.acquire(`call:${name}`)
    try {
      const result = await lease.callTool(name, args, options)
      if ("isError" in result && result.isError) throw new Error(toolErrorMessage(result))
      if (!("structuredContent" in result) || !result.structuredContent) {
        throw new Error(`ClipM MCP tool ${name} returned no structured content.`)
      }
      return result.structuredContent as T
    } finally {
      await lease.release()
    }
  }

  health(options?: ClipmCallOptions): Promise<EnvironmentStatus> {
    return this.callStructured<EnvironmentStatus>("health", {}, options)
  }

  scoreWork(path: string, scoreOptions?: ScoreOptions, callOptions?: ClipmCallOptions): Promise<WorkScoreResult> {
    return this.callStructured<WorkScoreResult>("score_work", scoreOptions ? { path, options: scoreOptions } : { path }, callOptions)
  }

  getWorkScore(path: string, callOptions?: ClipmCallOptions): Promise<WorkScoreLookupResult> {
    return this.callStructured<WorkScoreLookupResult>("get_work_score", { path }, callOptions)
  }

  scoreLibrary(path: string, scoreOptions?: ScoreOptions, callOptions?: ClipmCallOptions): Promise<ScoreLibraryResult> {
    return this.callStructured<ScoreLibraryResult>("score_library", scoreOptions ? { path, options: scoreOptions } : { path }, callOptions)
  }

  listReviewItems(status: ReviewStatus = "pending", limit = 100, options?: ClipmCallOptions): Promise<ReviewItemsResult> {
    return this.callStructured<ReviewItemsResult>("list_review_items", { status, limit }, options)
  }

  resolveReviewItem(command: ResolveReviewItemCommand, options?: ClipmCallOptions): Promise<WorkScoreResult> {
    return this.callStructured<WorkScoreResult>("resolve_review_item", { ...command }, options)
  }

  getPerceptualRecoveryStatus(limit = 100, options?: ClipmCallOptions): Promise<PerceptualRecoveryStatus> {
    return this.callStructured<PerceptualRecoveryStatus>("perceptual_recovery_status", { limit }, options)
  }

  applyFeedback(command: ApplyFeedbackCommand, options?: ClipmCallOptions): Promise<FeedbackApplyResult> {
    return this.callStructured<FeedbackApplyResult>("apply_feedback", { ...command }, options)
  }

  listFeedbackEvents(
    command: ListFeedbackEventsCommand = {},
    options?: ClipmCallOptions,
  ): Promise<FeedbackEventsResult> {
    return this.callStructured<FeedbackEventsResult>("list_feedback_events", { ...command }, options)
  }

  undoFeedback(command: UndoFeedbackCommand, options?: ClipmCallOptions): Promise<FeedbackApplyResult> {
    return this.callStructured<FeedbackApplyResult>("undo_feedback", { ...command }, options)
  }

  scanFeedback(path: string, options?: ClipmCallOptions): Promise<FeedbackScanResult> {
    return this.callStructured<FeedbackScanResult>("scan_feedback", { path }, options)
  }

  removeWorkMetadata(path: string, options?: ClipmCallOptions): Promise<RemoveWorkMetadataResult> {
    return this.callStructured<RemoveWorkMetadataResult>("remove_work_metadata", { path }, options)
  }

  trainHeads(_command: TrainHeadsCommand = {}, options?: ClipmCallOptions): Promise<TrainingResult> {
    return this.callStructured<TrainingResult>("train_heads", {}, options)
  }

  runAutoTraining(batchSize: number, options?: ClipmCallOptions): Promise<AutoTrainingResult> {
    return this.callStructured<AutoTrainingResult>("run_auto_training", { batchSize }, options)
  }

  listModels(command: ListModelsCommand = {}, options?: ClipmCallOptions): Promise<ModelsResult> {
    return this.callStructured<ModelsResult>("list_models", { ...command }, options)
  }

  activateModel(command: ActivateModelCommand, options?: ClipmCallOptions): Promise<ModelActivationResult> {
    return this.callStructured<ModelActivationResult>("activate_model", { ...command }, options)
  }

  rollbackModel(command: RollbackModelCommand, options?: ClipmCallOptions): Promise<ModelActivationResult> {
    return this.callStructured<ModelActivationResult>("rollback_model", { ...command }, options)
  }

  environmentStatus(options?: ClipmCallOptions): Promise<EnvironmentStatus> {
    return this.callStructured<EnvironmentStatus>("environment_status", {}, options)
  }

  migrateEnvironment(command: MigrateEnvironmentCommand, options?: ClipmCallOptions): Promise<EnvironmentMigrationResult> {
    return this.callStructured<EnvironmentMigrationResult>("migrate_environment", { ...command }, options)
  }

  async dispose(): Promise<void> {
    if (this.#leases.size > 0) throw new Error(`Cannot dispose ClipM worker manager with ${this.#leases.size} active lease(s).`)
    this.#disposed = true
    await this.#stopConnection()
  }

  async #ensureConnection(): Promise<ClipmMcpConnection> {
    if (this.#stopping) await this.#stopping
    if (this.#connection) return this.#connection
    this.#starting ??= (this.#options.createConnection ?? createClipmMcpConnection)(this.#options)
      .then((connection) => {
        this.#connection = connection
        return connection
      })
      .finally(() => { this.#starting = undefined })
    return await this.#starting
  }

  async #stopConnection(): Promise<void> {
    if (this.#stopping) return await this.#stopping
    const connection = this.#connection
    if (!connection) return
    this.#connection = undefined
    this.#stopping = connection.close().finally(() => { this.#stopping = undefined })
    await this.#stopping
  }
}

function toolErrorMessage(result: ClipmCallResult): string {
  const content = "content" in result ? result.content : undefined
  if (!Array.isArray(content)) return "ClipM MCP tool failed."
  const text = content.find((item): item is { type: "text"; text: string } => (
    typeof item === "object" && item !== null && item.type === "text" && typeof item.text === "string"
  ))
  return text?.text ?? "ClipM MCP tool failed."
}
