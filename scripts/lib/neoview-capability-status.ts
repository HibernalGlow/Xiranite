import { spawnSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { z } from "zod"

export const CAPABILITY_DIMENSIONS = ["core", "transport", "gui", "cli", "tui", "evidence"] as const
export const CAPABILITY_PROGRESS_VALUES = ["pending", "partial", "complete", "not-applicable"] as const
export const OVERALL_PROGRESS_VALUES = ["pending", "partial", "complete"] as const

export type CapabilityDimension = typeof CAPABILITY_DIMENSIONS[number]
export type CapabilityProgress = typeof CAPABILITY_PROGRESS_VALUES[number]
export type OverallProgress = typeof OVERALL_PROGRESS_VALUES[number]
export type CapabilityStatus = Record<CapabilityDimension, CapabilityProgress>

export const capabilityProgressSchema = z.enum(CAPABILITY_PROGRESS_VALUES)
export const capabilityStatusSchema = z.object({
  core: capabilityProgressSchema,
  transport: capabilityProgressSchema,
  gui: capabilityProgressSchema,
  cli: capabilityProgressSchema,
  tui: capabilityProgressSchema,
  evidence: capabilityProgressSchema,
}).strict()

const featureDispositionSchema = z.enum(["migrate", "preserved", "host-replaced", "import-only", "removed-with-approval"])
const cardDispositionSchema = z.enum(["migrate", "replace"])
const surfaceSchema = z.enum(["GUI", "CLI", "TUI"])

export const featureMatrixSchema = z.object({
  schemaVersion: z.literal(2),
  sourceRevision: z.string().min(1),
  features: z.array(z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    legacySourcePatterns: z.array(z.string()),
    legacyCommandPatterns: z.array(z.string()),
    settingsKeys: z.array(z.string()),
    dataStores: z.array(z.string()),
    surfaces: z.array(z.enum(["gui", "cli", "tui"])),
    disposition: featureDispositionSchema,
    capabilityStatus: capabilityStatusSchema,
    behaviorCases: z.array(z.string()),
    testIds: z.array(z.string()),
    plannedTestIds: z.array(z.string()).default([]),
    benchmarkIds: z.array(z.string()),
    knownDifferences: z.array(z.string()),
  }).strict()),
}).strict()

export const cardMatrixSchema = z.object({
  schemaVersion: z.literal(2),
  source: z.object({ file: z.string(), hash: z.string(), cardCount: z.number().int().nonnegative() }).strict(),
  priorities: z.array(z.enum(["core", "integration", "deferred"])),
  hostOnlyCurrentCards: z.array(z.object({
    id: z.string().min(1),
    rationale: z.string().min(1),
    testIds: z.array(z.string().min(1)).min(1),
  }).strict()).default([]),
  cards: z.array(z.object({
    legacyId: z.string().min(1),
    title: z.string().min(1),
    panelId: z.string().min(1),
    priority: z.enum(["core", "integration", "deferred"]),
    featureId: z.string().min(1),
    disposition: cardDispositionSchema,
    capabilityStatus: capabilityStatusSchema,
    currentCardId: z.string().min(1).optional(),
    replacement: z.string().min(1).optional(),
    sourceComponent: z.string().min(1).optional(),
    sourceDisposition: z.enum(["component", "registry-only"]).optional(),
    sourceNotes: z.string().min(1).optional(),
  }).strict()),
}).strict()

const sourceUiInventorySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  sourceEvidence: z.array(z.string().min(1)).min(1),
  acceptanceItems: z.array(z.string().min(1)).min(1),
  mappedChecklistIds: z.array(z.string().min(1)).min(1),
}).strict()

const unsupportedNodeSchema = z.object({
  node: z.string().min(1),
  source: z.string().min(1),
  replacement: z.string().min(1),
}).strict()

const inventorySummarySchema = z.object({
  sourceUiGroups: z.number().int().nonnegative(),
  controlsAndStates: z.number().int().nonnegative(),
  acceptanceItems: z.number().int().nonnegative(),
  sourceFiles: z.number().int().nonnegative(),
}).strict()

export const detailedChecklistSchema = z.object({
  schemaVersion: z.literal(2),
  featureId: z.string().min(1),
  legacyCardId: z.string().min(1),
  title: z.string().optional(),
  panelId: z.string().min(1).optional(),
  priority: z.enum(["core", "integration", "deferred"]).optional(),
  sourceRoot: z.string().min(1),
  sourceRevision: z.string().min(1).optional(),
  sourceHash: z.string().min(1).optional(),
  storeHash: z.string().min(1).optional(),
  utilityHash: z.string().min(1).optional(),
  astPrototype: z.string().min(1).optional(),
  visualBaseline: z.string().min(1).optional(),
  visualTarget: z.string().min(1).optional(),
  inventorySummary: inventorySummarySchema.optional(),
  completionRule: z.string().min(1),
  unsupportedNodes: z.array(unsupportedNodeSchema).optional(),
  sourceUiInventory: z.array(sourceUiInventorySchema).min(1),
  items: z.array(z.object({
    id: z.string().min(1),
    category: z.string().min(1),
    title: z.string().min(1),
    sourceEvidence: z.array(z.string().min(1)).min(1),
    targetContract: z.string().min(1),
    surfaces: z.array(surfaceSchema).min(1),
    capabilityStatus: capabilityStatusSchema,
    testIds: z.array(z.string()),
    plannedTestIds: z.array(z.string()).default([]),
    notes: z.string(),
  }).strict()).min(1),
}).strict()

export type FeatureMatrix = z.infer<typeof featureMatrixSchema>
export type FeatureEntry = FeatureMatrix["features"][number]
export type CardMatrix = z.infer<typeof cardMatrixSchema>
export type CardEntry = CardMatrix["cards"][number]
export type DetailedChecklist = z.infer<typeof detailedChecklistSchema>
export type ChecklistItem = DetailedChecklist["items"][number]
export type SourceUiInventoryGroup = DetailedChecklist["sourceUiInventory"][number]

export interface TestEvidenceIndex {
  readonly pathsById: ReadonlyMap<string, readonly string[]>
  dimensions(testIds: readonly string[]): ReadonlySet<CapabilityDimension>
  has(testId: string): boolean
  paths(testId: string): readonly string[]
}

export function deriveOverallStatus(status: CapabilityStatus): OverallProgress {
  const applicable = CAPABILITY_DIMENSIONS.map((dimension) => status[dimension])
    .filter((value): value is Exclude<CapabilityProgress, "not-applicable"> => value !== "not-applicable")
  if (!applicable.length || applicable.every((value) => value === "pending")) return "pending"
  if (applicable.every((value) => value === "complete")) return "complete"
  return "partial"
}

export function aggregateCapabilityStatuses(statuses: readonly CapabilityStatus[]): CapabilityStatus {
  return Object.fromEntries(CAPABILITY_DIMENSIONS.map((dimension) => {
    const values = statuses.map((status) => status[dimension]).filter((value) => value !== "not-applicable")
    if (!values.length) return [dimension, "not-applicable"]
    if (values.every((value) => value === "complete")) return [dimension, "complete"]
    if (values.every((value) => value === "pending")) return [dimension, "pending"]
    return [dimension, "partial"]
  })) as CapabilityStatus
}

export function statusCounts(values: readonly CapabilityStatus[]): Record<CapabilityDimension, Record<CapabilityProgress, number>> {
  return Object.fromEntries(CAPABILITY_DIMENSIONS.map((dimension) => [
    dimension,
    Object.fromEntries(CAPABILITY_PROGRESS_VALUES.map((progress) => [
      progress,
      values.filter((value) => value[dimension] === progress).length,
    ])),
  ])) as Record<CapabilityDimension, Record<CapabilityProgress, number>>
}

export function overallCounts(values: readonly CapabilityStatus[]): Record<OverallProgress, number> {
  return Object.fromEntries(OVERALL_PROGRESS_VALUES.map((progress) => [
    progress,
    values.filter((value) => deriveOverallStatus(value) === progress).length,
  ])) as Record<OverallProgress, number>
}

export function compactCapabilityStatus(status: CapabilityStatus): string {
  const marker: Record<CapabilityProgress, string> = {
    complete: "C",
    partial: "P",
    pending: "-",
    "not-applicable": "N/A",
  }
  return CAPABILITY_DIMENSIONS.map((dimension) => `${dimension}=${marker[status[dimension]]}`).join(" ")
}

export function blockedDimensions(status: CapabilityStatus): CapabilityDimension[] {
  return CAPABILITY_DIMENSIONS.filter((dimension) => status[dimension] !== "complete" && status[dimension] !== "not-applicable")
}

export async function parseFeatureMatrix(path: string): Promise<FeatureMatrix> {
  return featureMatrixSchema.parse(await readJson(path))
}

export async function parseCardMatrix(path: string): Promise<CardMatrix> {
  return cardMatrixSchema.parse(await readJson(path))
}

export async function parseDetailedChecklist(path: string): Promise<DetailedChecklist> {
  return detailedChecklistSchema.parse(await readJson(path))
}

export async function buildTestEvidenceIndex(root: string): Promise<TestEvidenceIndex> {
  const tracked = spawnSync("git", ["-C", root, "ls-files"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  if (tracked.status !== 0) throw new Error(tracked.stderr || "git ls-files failed")
  const evidencePaths = tracked.stdout.split(/\r?\n/).filter((path) =>
    /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path)
    || /^scripts\/(?:audit|benchmark|verify)-neoview[^/]*\.ts$/.test(path),
  )
  const pathsById = new Map<string, string[]>()
  for (const path of evidencePaths) {
    const content = await readFile(resolve(root, path), "utf8")
    for (const match of content.matchAll(/\[([a-z0-9]+(?:[.-][a-z0-9-]+)+)\]/g)) {
      const id = match[1]!
      pathsById.set(id, [...(pathsById.get(id) ?? []), path.replaceAll("\\", "/")])
    }
  }
  return {
    pathsById,
    has: (testId) => pathsById.has(testId),
    paths: (testId) => pathsById.get(testId) ?? [],
    dimensions(testIds) {
      const dimensions = new Set<CapabilityDimension>()
      for (const id of testIds) {
        for (const path of pathsById.get(id) ?? []) {
          for (const dimension of classifyEvidence(path, id)) dimensions.add(dimension)
        }
      }
      return dimensions
    },
  }
}

export function seedDetailedCapabilityStatus(
  legacyStatus: OverallProgress,
  surfaces: readonly ("GUI" | "CLI" | "TUI")[],
  testIds: readonly string[],
  evidence: TestEvidenceIndex,
): CapabilityStatus {
  const covered = evidence.dimensions(testIds)
  const presentation = { gui: surfaces.includes("GUI"), cli: surfaces.includes("CLI"), tui: surfaces.includes("TUI") }
  const applicable = {
    core: covered.has("core"),
    transport: covered.has("transport"),
    ...presentation,
    evidence: true,
  }
  const hasGuiEndToEnd = testIds.some((id) => evidence.paths(id).some((path) => path.startsWith("tests/e2e/")))
  if (legacyStatus === "complete") {
    return Object.fromEntries(CAPABILITY_DIMENSIONS.map((dimension) => {
      if (!applicable[dimension]) return [dimension, "not-applicable"]
      if (dimension === "evidence") {
        const presentationCovered = (["gui", "cli", "tui"] as const)
          .filter((surface) => presentation[surface])
          .every((surface) => covered.has(surface))
        return [dimension, testIds.length && presentationCovered && (!presentation.gui || hasGuiEndToEnd) ? "complete" : "partial"]
      }
      return [dimension, covered.has(dimension) ? "complete" : "partial"]
    })) as CapabilityStatus
  }
  return Object.fromEntries(CAPABILITY_DIMENSIONS.map((dimension) => {
    if (!applicable[dimension]) return [dimension, "not-applicable"]
    if (dimension === "evidence") return [dimension, testIds.length ? "partial" : "pending"]
    if (!covered.has(dimension)) return [dimension, legacyStatus === "partial" ? "partial" : "pending"]
    if (dimension === "gui") {
      const hasEndToEnd = testIds.some((id) => evidence.paths(id).some((path) => path.startsWith("tests/e2e/")))
      return [dimension, legacyStatus === "partial" && hasEndToEnd ? "complete" : "partial"]
    }
    return [dimension, legacyStatus === "partial" ? "complete" : "partial"]
  })) as CapabilityStatus
}

export function seedFeatureCapabilityStatus(
  surfaces: readonly ("gui" | "cli" | "tui")[],
  testIds: readonly string[],
  evidence: TestEvidenceIndex,
): CapabilityStatus {
  const covered = evidence.dimensions(testIds)
  const applicable = {
    core: true,
    transport: covered.has("transport"),
    gui: surfaces.includes("gui"),
    cli: surfaces.includes("cli"),
    tui: surfaces.includes("tui"),
    evidence: true,
  }
  return Object.fromEntries(CAPABILITY_DIMENSIONS.map((dimension) => {
    if (!applicable[dimension]) return [dimension, "not-applicable"]
    if (dimension === "evidence") return [dimension, testIds.length ? "partial" : "pending"]
    return [dimension, covered.has(dimension) ? "partial" : "pending"]
  })) as CapabilityStatus
}

function classifyEvidence(path: string, id: string): CapabilityDimension[] {
  const dimensions = new Set<CapabilityDimension>()
  const normalized = path.toLocaleLowerCase()
  if (normalized.startsWith("src/nodes/neoview/") || normalized.startsWith("tests/e2e/neoview/")) dimensions.add("gui")
  if (/\bcli\b/.test(normalized) || /(?:^|[.-])cli(?:[.-]|$)/.test(id)) dimensions.add("cli")
  if (/\btui\b|opentui/.test(normalized) || /(?:^|[.-])tui(?:[.-]|$)/.test(id)) dimensions.add("tui")
  if (/asset-route|remote|reader-http-client|packages\/backend\//.test(normalized) || /(?:^|\.)(?:http|route|client|connect|wire)(?:\.|$)/.test(id)) dimensions.add("transport")
  if (/packages\/nodes\/neoview\/src\/(?:application|domain|platform|testing)|packages\/services\//.test(normalized)
    && !dimensions.has("cli") && !dimensions.has("tui") && !/asset-route|remote/.test(normalized)) dimensions.add("core")
  return [...dimensions]
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown
}
