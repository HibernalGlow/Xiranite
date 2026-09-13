import type { InteractionValues, TerminalInteractionSchema } from "@xiranite/cli-runtime/interaction"
import type { ClipmAction, ClipmInput, ClipmResult } from "./core.js"

export type ClipmInteractionValues = InteractionValues & {
  action: ClipmAction
  path: string
  directoryPathsText: string
  scope: "library" | "work"
  rescore: boolean
  rename: boolean
  writeMetadata: boolean
  dryRun: boolean
  workId: string
  classification: "unset" | "P" | "N" | "clear"
  rankingEnabled: boolean
  ranking: number
  source: "gui" | "neoview" | "filename"
  eventId: string
  includeUndone: boolean
  feedbackLimit: number
  feedbackBeforeOccurredAt: string
  feedbackBeforeEventId: string
  reviewStatus: "pending" | "resolved"
  reviewLimit: number
  reviewId: string
  resolution: "use_filename" | "use_json" | "link_existing" | "new_work"
  existingWorkId: string
  recoveryLimit: number
  calibrationMaxWorks: number
  allowInsufficientRankingCorrections: boolean
  batchSize: number
  includeFailed: boolean
  bundleVersion: number
  force: boolean
  targetRuntimeRoot: string
  device: "cuda" | "cpu"
}

const ACTIONS: readonly { value: ClipmAction; label: string }[] = [
  { value: "score", label: "Score library / work" },
  { value: "work-get", label: "Read one work score" },
  { value: "directory-scores-get", label: "Read directory scores" },
  { value: "feedback-scan", label: "Scan feedback suffixes" },
  { value: "feedback-apply", label: "Apply confirmed feedback" },
  { value: "feedback-list", label: "Feedback history" },
  { value: "feedback-undo", label: "Undo feedback" },
  { value: "review-list", label: "Review queue" },
  { value: "review-resolve", label: "Resolve review" },
  { value: "recovery-status", label: "Recovery status" },
  { value: "recovery-calibrate", label: "Calibrate recovery" },
  { value: "train", label: "Train heads" },
  { value: "train-auto", label: "Automatic training" },
  { value: "model-list", label: "List models" },
  { value: "model-activate", label: "Activate model" },
  { value: "model-rollback", label: "Rollback model" },
  { value: "env-status", label: "Environment status" },
  { value: "env-configure", label: "Configure environment" },
  { value: "env-migrate", label: "Migrate environment" },
  { value: "work-remove-metadata", label: "Remove work metadata" },
]

const INITIAL_VALUES: ClipmInteractionValues = {
  action: "score",
  path: "",
  directoryPathsText: "",
  scope: "library",
  rescore: false,
  rename: true,
  writeMetadata: true,
  dryRun: false,
  workId: "",
  classification: "unset",
  rankingEnabled: false,
  ranking: 500,
  source: "gui",
  eventId: "",
  includeUndone: true,
  feedbackLimit: 100,
  feedbackBeforeOccurredAt: "",
  feedbackBeforeEventId: "",
  reviewStatus: "pending",
  reviewLimit: 100,
  reviewId: "",
  resolution: "use_filename",
  existingWorkId: "",
  recoveryLimit: 25,
  calibrationMaxWorks: 100,
  allowInsufficientRankingCorrections: false,
  batchSize: 20,
  includeFailed: true,
  bundleVersion: 1,
  force: false,
  targetRuntimeRoot: "",
  device: "cuda",
}

export function createClipmInteractionSchema(
  defaults: Partial<ClipmInteractionValues> = {},
  language: "zh" | "en" = "zh",
): TerminalInteractionSchema<ClipmInput, ClipmResult> {
  const text = (zh: string, en: string) => language === "zh" ? zh : en
  const initialValues = { ...INITIAL_VALUES, ...defaults } as ClipmInteractionValues
  const actionField = { id: "action", label: text("操作", "Action"), kind: "select" as const, role: "action" as const, options: ACTIONS }
  const pathField = { id: "path", label: text("路径", "Path"), kind: "text" as const, placeholder: text("作品、文件或目录路径", "Work, file, or directory path") }
  const directoryPathsField = { id: "directoryPathsText", label: text("目录路径", "Directory paths"), kind: "path-list" as const, lines: 5, placeholder: text("每行一个目录", "One directory per line") }
  const fields = [
    actionField,
    pathField,
    directoryPathsField,
    { id: "scope", label: text("评分范围", "Score scope"), kind: "select" as const, options: [{ value: "library", label: text("整个目录", "Library") }, { value: "work", label: text("单个作品", "Work") }], visibleWhen: actionIs("score") },
    { id: "rescore", label: text("重新评分", "Rescore"), kind: "boolean" as const, visibleWhen: actionIs("score") },
    { id: "rename", label: text("同步重命名", "Rename files"), kind: "boolean" as const, visibleWhen: actionIs("score") },
    { id: "writeMetadata", label: text("写入元数据", "Write metadata"), kind: "boolean" as const, visibleWhen: actionIs("score") },
    { id: "dryRun", label: text("预演", "Dry run"), kind: "boolean" as const, visibleWhen: actionIs("score") },
    { id: "workId", label: text("作品 ID", "Work ID"), kind: "text" as const, visibleWhen: actionIs("feedback-apply", "feedback-list") },
    { id: "classification", label: text("分类修正", "Classification"), kind: "select" as const, options: [{ value: "unset", label: text("不修改", "Leave unchanged") }, { value: "P", label: "P" }, { value: "N", label: "N" }, { value: "clear", label: text("清除", "Clear") }], visibleWhen: actionIs("feedback-apply") },
    { id: "rankingEnabled", label: text("修改数值评分", "Change ranking"), kind: "boolean" as const, visibleWhen: actionIs("feedback-apply") },
    { id: "ranking", label: text("数值评分", "Ranking"), kind: "number" as const, min: 0, max: 1000, visibleWhen: (values: Readonly<InteractionValues>) => values.action === "feedback-apply" && values.rankingEnabled === true },
    { id: "source", label: text("来源", "Source"), kind: "select" as const, options: [{ value: "gui", label: "GUI" }, { value: "neoview", label: "NeoView" }, { value: "filename", label: text("文件名", "Filename") }], visibleWhen: actionIs("feedback-apply", "feedback-undo") },
    { id: "eventId", label: text("事件 ID", "Event ID"), kind: "text" as const, visibleWhen: actionIs("feedback-undo") },
    { id: "includeUndone", label: text("包含已撤销", "Include undone"), kind: "boolean" as const, visibleWhen: actionIs("feedback-list") },
    { id: "feedbackLimit", label: text("历史条数", "History limit"), kind: "number" as const, min: 1, max: 1000, visibleWhen: actionIs("feedback-list") },
    { id: "feedbackBeforeOccurredAt", label: text("时间游标", "Before time"), kind: "text" as const, visibleWhen: actionIs("feedback-list") },
    { id: "feedbackBeforeEventId", label: text("事件游标", "Before event"), kind: "text" as const, visibleWhen: actionIs("feedback-list") },
    { id: "reviewStatus", label: text("审核状态", "Review status"), kind: "select" as const, options: [{ value: "pending", label: text("待处理", "Pending") }, { value: "resolved", label: text("已处理", "Resolved") }], visibleWhen: actionIs("review-list") },
    { id: "reviewLimit", label: text("审核条数", "Review limit"), kind: "number" as const, min: 1, max: 1000, visibleWhen: actionIs("review-list") },
    { id: "reviewId", label: text("审核 ID", "Review ID"), kind: "text" as const, visibleWhen: actionIs("review-resolve") },
    { id: "resolution", label: text("处理方式", "Resolution"), kind: "select" as const, options: [{ value: "use_filename", label: "Use filename" }, { value: "use_json", label: "Use JSON" }, { value: "link_existing", label: "Link existing" }, { value: "new_work", label: "New work" }], visibleWhen: actionIs("review-resolve") },
    { id: "existingWorkId", label: text("现有作品 ID", "Existing work ID"), kind: "text" as const, visibleWhen: (values: Readonly<InteractionValues>) => values.action === "review-resolve" && values.resolution === "link_existing" },
    { id: "recoveryLimit", label: text("观测条数", "Observation limit"), kind: "number" as const, min: 1, max: 1000, visibleWhen: actionIs("recovery-status") },
    { id: "calibrationMaxWorks", label: text("校准作品上限", "Calibration work limit"), kind: "number" as const, min: 12, max: 500, visibleWhen: actionIs("recovery-calibrate") },
    { id: "allowInsufficientRankingCorrections", label: text("允许低于排名门槛", "Allow insufficient ranking corrections"), kind: "boolean" as const, visibleWhen: actionIs("train") },
    { id: "batchSize", label: text("自动训练门槛", "Auto-training threshold"), kind: "number" as const, min: 1, max: 1000, visibleWhen: actionIs("train-auto") },
    { id: "includeFailed", label: text("包含失败模型", "Include failed models"), kind: "boolean" as const, visibleWhen: actionIs("model-list") },
    { id: "bundleVersion", label: text("模型版本", "Bundle version"), kind: "number" as const, min: 1, max: Number.MAX_SAFE_INTEGER, visibleWhen: actionIs("model-activate", "model-rollback") },
    { id: "force", label: text("强制激活", "Force activation"), kind: "boolean" as const, visibleWhen: actionIs("model-activate") },
    { id: "targetRuntimeRoot", label: text("运行时目录", "Runtime root"), kind: "text" as const, visibleWhen: actionIs("env-configure", "env-migrate") },
    { id: "device", label: text("设备", "Device"), kind: "select" as const, options: [{ value: "cuda", label: "CUDA" }, { value: "cpu", label: "CPU" }], visibleWhen: actionIs("env-configure") },
  ]

  return {
    id: "clipm",
    title: "ClipM",
    description: text("评分、反馈、训练、模型与环境控制台", "Scoring, feedback, training, model, and environment control plane"),
    initialValues,
    fields,
    view: {
      sections: [
        { id: "command", title: text("操作", "Command"), fieldIds: ["action", "path", "directoryPathsText", "scope", "rescore", "rename", "writeMetadata", "dryRun"] },
        { id: "feedback", title: text("反馈", "Feedback"), fieldIds: ["workId", "classification", "rankingEnabled", "ranking", "source", "eventId", "includeUndone", "feedbackLimit", "feedbackBeforeOccurredAt", "feedbackBeforeEventId", "reviewStatus", "reviewLimit", "reviewId", "resolution", "existingWorkId"] },
        { id: "maintenance", title: text("训练与模型", "Training and models"), fieldIds: ["recoveryLimit", "calibrationMaxWorks", "allowInsufficientRankingCorrections", "batchSize", "includeFailed", "bundleVersion", "force"] },
        { id: "environment", title: text("环境", "Environment"), fieldIds: ["targetRuntimeRoot", "device"] },
      ],
      dashboard: {
        title: text("ClipM 结果", "ClipM result"),
        description: text("操作完成后显示摘要、评分和事件", "Summary, scores, and events appear after each operation"),
        display: (values) => ({ primary: String(values.action ?? "score"), secondary: String(values.path ?? values.directoryPathsText ?? ""), metrics: [] }),
      },
    },
    toInput: toInput,
    validate: validateInput,
    preview: previewInput,
    isDangerous: isDangerousInput,
    dangerPrompt: (input) => ({
      title: text("确认写入操作", "Confirm write operation"),
      body: text(`即将执行 ${input.action}，可能修改文件、元数据、反馈或模型。`, `The ${input.action} action may modify files, metadata, feedback, or model state.`),
      confirmLabel: text("确认执行", "Run now"),
    }),
    result: (result) => resultSummary(result, text),
  }
}

function actionIs(...actions: ClipmAction[]) {
  return (values: Readonly<InteractionValues>) => actions.includes(String(values.action ?? "score") as ClipmAction)
}

function toInput(values: Readonly<InteractionValues>): ClipmInput {
  const action = String(values.action ?? "score") as ClipmAction
  const classification = values.classification === "P" || values.classification === "N" ? values.classification : values.classification === "clear" ? null : undefined
  const ranking = values.rankingEnabled === true ? clampInteger(values.ranking, 0, 1000) : undefined
  return {
    action,
    path: optionalText(values.path),
    directoryPaths: splitPaths(values.directoryPathsText),
    scope: values.scope === "work" ? "work" : "library",
    scoreOptions: { rescore: values.rescore === true, rename: values.rename !== false, writeMetadata: values.writeMetadata !== false, dryRun: values.dryRun === true },
    workId: optionalText(values.workId),
    classification,
    ranking,
    source: (values.source as ClipmInput["source"]) ?? "gui",
    eventId: optionalText(values.eventId),
    includeUndone: values.includeUndone !== false,
    feedbackLimit: clampInteger(values.feedbackLimit, 1, 1000),
    feedbackBeforeOccurredAt: optionalText(values.feedbackBeforeOccurredAt),
    feedbackBeforeEventId: optionalText(values.feedbackBeforeEventId),
    reviewStatus: values.reviewStatus === "resolved" ? "resolved" : "pending",
    reviewLimit: clampInteger(values.reviewLimit, 1, 1000),
    reviewId: optionalText(values.reviewId),
    resolution: values.resolution as ClipmInput["resolution"],
    existingWorkId: optionalText(values.existingWorkId),
    recoveryLimit: clampInteger(values.recoveryLimit, 1, 1000),
    calibrationMaxWorks: clampInteger(values.calibrationMaxWorks, 12, 500),
    allowInsufficientRankingCorrections: values.allowInsufficientRankingCorrections === true,
    batchSize: clampInteger(values.batchSize, 1, 1000),
    includeFailed: values.includeFailed !== false,
    bundleVersion: clampInteger(values.bundleVersion, 1, Number.MAX_SAFE_INTEGER),
    force: values.force === true,
    targetRuntimeRoot: optionalText(values.targetRuntimeRoot),
    device: values.device === "cpu" ? "cpu" : "cuda",
  }
}

function validateInput(values: Readonly<InteractionValues>, input: ClipmInput): string | null {
  const action = input.action ?? "score"
  if (["score", "work-get", "feedback-scan", "work-remove-metadata"].includes(action) && !input.path?.trim()) return "A path is required."
  if (action === "directory-scores-get" && !input.directoryPaths?.length) return "At least one directory path is required."
  if (action === "feedback-apply" && !input.workId?.trim()) return "A work ID is required."
  if (action === "feedback-apply" && input.classification === undefined && input.ranking === undefined) return "Choose a classification or enable ranking correction."
  if (action === "feedback-undo" && !input.eventId?.trim()) return "An event ID is required."
  if (action === "review-resolve" && !input.reviewId?.trim()) return "A review ID is required."
  if (action === "env-configure" && (!input.targetRuntimeRoot?.trim() || !input.device)) return "Runtime root and device are required."
  if (action === "env-migrate" && !input.targetRuntimeRoot?.trim()) return "A target runtime root is required."
  if (values.feedbackBeforeOccurredAt && !values.feedbackBeforeEventId || values.feedbackBeforeEventId && !values.feedbackBeforeOccurredAt) return "Both feedback cursor fields are required together."
  return null
}

function previewInput(input: ClipmInput): readonly string[] {
  const path = input.path ?? input.directoryPaths?.join(", ") ?? "(not set)"
  const flags = input.action === "score" ? `scope=${input.scope ?? "library"} dryRun=${input.scoreOptions?.dryRun === true}` : ""
  return [`${input.action ?? "score"} ${path}`, flags].filter(Boolean)
}

function isDangerousInput(input: ClipmInput): boolean {
  if (input.action === "score") return input.scoreOptions?.dryRun !== true && (input.scoreOptions?.rename !== false || input.scoreOptions?.writeMetadata !== false)
  return ["feedback-scan", "feedback-apply", "feedback-undo", "review-resolve", "train", "train-auto", "model-activate", "model-rollback", "env-configure", "env-migrate", "work-remove-metadata"].includes(input.action ?? "")
}

function resultSummary(result: ClipmResult, text: (zh: string, en: string) => string) {
  if (!result.success) return { success: false, message: result.message, lines: [] }
  const action = result.data?.action ?? "unknown"
  const value = asRecord(result.data?.result)
  const lines = resultLines(action, value, text)
  const table = resultTable(action, value, text)
  return { success: true, message: result.message, lines, table }
}

function resultLines(action: string, value: Record<string, unknown>, text: (zh: string, en: string) => string): string[] {
  if (action === "score") return [`${text("发现作品", "Works discovered")}: ${value.discoveredWorkCount ?? value.path ?? "--"}`, `${text("成功", "Succeeded")}: ${value.succeededWorkCount ?? "--"}`, `${text("失败", "Failed")}: ${value.failedWorkCount ?? "--"}`]
  if (action === "train" || action === "train-auto") {
    const training = asRecord(value.training)
    return [`${text("状态", "Status")}: ${value.status ?? "--"}`, `${text("活动模型", "Active model")}: ${value.activeBundleVersion ?? training.activeBundleVersion ?? "--"}`]
  }
  if (action === "env-status" || action === "env-configure") return [`${text("设备", "Device")}: ${value.device ?? "--"}`, `${text("运行时", "Runtime")}: ${value.runtimeRoot ?? "--"}`, `${text("健康", "Healthy")}: ${value.healthy ?? "--"}`]
  if (action === "model-list") return [`${text("活动版本", "Active version")}: ${value.activeBundleVersion ?? "--"}`, `${text("模型数量", "Models")}: ${Array.isArray(value.models) ? value.models.length : 0}`]
  if (action === "feedback-list") return [`${text("事件", "Events")}: ${Array.isArray(value.events) ? value.events.length : 0}`]
  return Object.entries(value).slice(0, 4).map(([key, entry]) => `${key}: ${formatValue(entry)}`)
}

function resultTable(action: string, value: Record<string, unknown>, text: (zh: string, en: string) => string) {
  if (action === "score" && Array.isArray(value.works)) return table(["label", "score", "path"], value.works, text)
  if (action === "directory-scores-get" && Array.isArray(value.directories)) return table(["directoryPath", "score", "label", "path"], value.directories.map((entry) => { const item = asRecord(entry); const work = asRecord(item.work); return { directoryPath: item.directoryPath, score: work.score, label: work.label, path: work.path } }), text)
  if (action === "feedback-list" && Array.isArray(value.events)) return table(["eventId", "source", "workId", "currentPath"], value.events, text)
  if (action === "review-list" && Array.isArray(value.items)) return table(["status", "kind", "reviewId", "path"], value.items, text)
  if (action === "model-list" && Array.isArray(value.models)) return table(["bundleVersion", "status", "classificationValidationStatus", "rankingValidationStatus"], value.models, text)
  if (action === "score" && value.label) return table(["label", "score", "path"], [value], text)
  return undefined
}

function table(keys: string[], entries: unknown[], text: (zh: string, en: string) => string) {
  const labels: Record<string, string> = { label: text("分类", "Label"), score: text("评分", "Score"), path: text("路径", "Path"), directoryPath: text("目录", "Directory"), eventId: text("事件", "Event"), source: text("来源", "Source"), workId: text("作品", "Work"), currentPath: text("当前路径", "Current path"), status: text("状态", "Status"), kind: text("类型", "Kind"), reviewId: text("审核", "Review"), bundleVersion: text("版本", "Version"), classificationValidationStatus: text("分类验证", "Classification"), rankingValidationStatus: text("排名验证", "Ranking") }
  return { columns: keys.map((id) => ({ id, label: labels[id] ?? id, width: id.toLowerCase().includes("path") ? 42 : 16 })), rows: entries.map((entry) => { const record = asRecord(entry); return Object.fromEntries(keys.map((key) => [key, formatValue(record[key])])) }), emptyMessage: text("没有结果", "No results") }
}

function splitPaths(value: unknown): string[] { return String(value ?? "").split(/[\r\n;,]+/).map((item) => item.trim()).filter(Boolean) }
function optionalText(value: unknown): string | undefined { const text = String(value ?? "").trim(); return text || undefined }
function clampInteger(value: unknown, minimum: number, maximum: number): number { const parsed = Number(value); return Number.isInteger(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : minimum }
function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function formatValue(value: unknown): string { return value === undefined || value === null ? "--" : typeof value === "object" ? JSON.stringify(value) : String(value) }
