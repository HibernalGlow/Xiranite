import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

import {
  CAPABILITY_DIMENSIONS,
  aggregateCapabilityStatuses,
  buildTestEvidenceIndex,
  cardMatrixSchema,
  detailedChecklistSchema,
  featureMatrixSchema,
  seedDetailedCapabilityStatus,
  seedFeatureCapabilityStatus,
  type CapabilityStatus,
  type OverallProgress,
  type TestEvidenceIndex,
} from "./lib/neoview-capability-status"

interface LegacyFeatureMatrix {
  schemaVersion: 1
  sourceRevision: string
  statusValues: string[]
  features: Array<Record<string, unknown> & {
    id: string
    surfaces: Array<"gui" | "cli" | "tui">
    status: "pending" | "preserved" | "host-replaced" | "import-only" | "removed-with-approval"
    testIds: string[]
  }>
}

interface LegacyCardMatrix {
  schemaVersion: 1
  source: { file: string; hash: string; cardCount: number }
  statuses: string[]
  priorities: string[]
  cards: Array<Record<string, unknown> & {
    legacyId: string
    featureId: string
    status: "pending" | "partial" | "migrated" | "replaced"
  }>
}

interface LegacyDetailedChecklist {
  schemaVersion: 1
  legacyCardId: string
  statusValues: string[]
  items: Array<Record<string, unknown> & {
    id: string
    surfaces: Array<"GUI" | "CLI" | "TUI">
    status: OverallProgress
    testIds: string[]
  }>
  [key: string]: unknown
}

interface ScopeFile { cards: Array<{ legacyId: string; checklistRef?: string }> }

const root = resolve(import.meta.dir, "..")
const featurePath = resolve(root, "migration/neoview/feature-compatibility.json")
const cardPath = resolve(root, "migration/neoview/card-compatibility.json")
const contractPath = resolve(root, "migration/neoview/card-acceptance-contract.json")
const scopePath = resolve(root, "migration/neoview/card-functional-scopes.json")
const write = process.argv.includes("--write")
const check = process.argv.includes("--check")
if (write && check) throw new Error("Choose either --write or --check.")

const evidence = await buildTestEvidenceIndex(root)
const scopes = await readJson<ScopeFile>(scopePath)
const detailedPaths = [...new Set(scopes.cards.flatMap((card) => card.checklistRef ? [card.checklistRef] : []))]
const outputs = new Map<string, string>()
const detailedStatuses = new Map<string, CapabilityStatus>()
let migratedItems = 0

for (const relativePath of detailedPaths) {
  const path = resolve(root, relativePath)
  const raw = await readJson<Record<string, unknown>>(path)
  const migrated = normalizeDetailedEvidence(migrateDetailedChecklist(raw, evidence), evidence)
  outputs.set(path, serialize(migrated))
  detailedStatuses.set(migrated.legacyCardId, aggregateCapabilityStatuses(migrated.items.map((item) => item.capabilityStatus)))
  migratedItems += migrated.items.length
}

const rawFeatures = await readJson<Record<string, unknown>>(featurePath)
const migratedFeatures = normalizeFeatureEvidence(migrateFeatureMatrix(rawFeatures, evidence), evidence)
outputs.set(featurePath, serialize(migratedFeatures))

const rawCards = await readJson<Record<string, unknown>>(cardPath)
const migratedCards = migrateCardMatrix(rawCards, migratedFeatures.features, detailedStatuses)
outputs.set(cardPath, serialize(migratedCards))

const rawContract = await readJson<Record<string, unknown>>(contractPath)
const migratedContract = migrateAcceptanceContract(rawContract)
outputs.set(contractPath, serialize(migratedContract))

await validateOutputs(outputs, detailedPaths, migratedItems)

const changed = [] as string[]
for (const [path, content] of outputs) {
  if (await readFile(path, "utf8") !== content) changed.push(relative(path))
}

if (check) {
  if (changed.length) throw new Error(`NeoView capability status migration is not applied or not idempotent:\n- ${changed.join("\n- ")}`)
  process.stdout.write(`NeoView capability status schema is current: ${migratedFeatures.features.length} features, ${migratedCards.cards.length} Cards, ${migratedItems} checklist items.\n`)
} else if (write) {
  for (const [path, content] of outputs) await writeFile(path, content, "utf8")
  process.stdout.write(`Migrated ${changed.length} file(s): ${migratedFeatures.features.length} features, ${migratedCards.cards.length} Cards, ${migratedItems} checklist items.\n`)
} else {
  process.stdout.write(JSON.stringify({
    mode: "dry-run",
    changedFiles: changed,
    counts: { features: migratedFeatures.features.length, cards: migratedCards.cards.length, checklistItems: migratedItems },
    next: "Run with --write to apply the deterministic migration.",
  }, null, 2) + "\n")
}

function migrateFeatureMatrix(raw: Record<string, unknown>, index: TestEvidenceIndex) {
  if (raw.schemaVersion === 2) return parseCurrentFeatureMatrix(raw)
  const legacy = raw as unknown as LegacyFeatureMatrix
  if (legacy.schemaVersion !== 1 || !Array.isArray(legacy.features)) throw new Error("Unsupported feature compatibility schema.")
  return featureMatrixSchema.parse({
    schemaVersion: 2,
    sourceRevision: legacy.sourceRevision,
    features: legacy.features.map(({ status, ...feature }) => ({
      ...without(feature, "capabilityStatus"),
      disposition: status === "pending" ? "migrate" as const : status,
      capabilityStatus: seedFeatureCapabilityStatus(feature.surfaces, feature.testIds, index),
    })),
  })
}

function migrateCardMatrix(
  raw: Record<string, unknown>,
  features: Array<{ id: string; surfaces: Array<"gui" | "cli" | "tui"> }>,
  detailed: ReadonlyMap<string, CapabilityStatus>,
) {
  if (raw.schemaVersion === 2) {
    const current = parseCurrentCardMatrix(raw)
    return cardMatrixSchema.parse({
      ...current,
      cards: current.cards.map((card) => ({
        ...card,
        capabilityStatus: detailed.get(card.legacyId) ?? card.capabilityStatus,
      })),
    })
  }
  const legacy = raw as unknown as LegacyCardMatrix
  if (legacy.schemaVersion !== 1 || !Array.isArray(legacy.cards)) throw new Error("Unsupported Card compatibility schema.")
  const featureSurfaces = new Map(features.map((feature) => [feature.id, feature.surfaces]))
  return cardMatrixSchema.parse({
    schemaVersion: 2,
    source: legacy.source,
    priorities: legacy.priorities,
    cards: legacy.cards.map(({ status, ...card }) => ({
      ...without(card, "capabilityStatus"),
      disposition: status === "replaced" ? "replace" as const : "migrate" as const,
      capabilityStatus: detailed.get(card.legacyId) ?? seedCardCapabilityStatus(status, featureSurfaces.get(card.featureId) ?? ["gui"]),
    })),
  })
}

function migrateDetailedChecklist(raw: Record<string, unknown>, index: TestEvidenceIndex) {
  if (raw.schemaVersion === 2) return parseCurrentDetailedChecklist(raw)
  const legacy = raw as unknown as LegacyDetailedChecklist
  if (legacy.schemaVersion !== 1 || !Array.isArray(legacy.items)) throw new Error(`Unsupported detailed checklist schema for ${String(legacy.legacyCardId)}.`)
  const { statusValues: _statusValues, ...checklist } = legacy
  return detailedChecklistSchema.parse({
    ...checklist,
    schemaVersion: 2,
    items: legacy.items.map(({ status, ...item }) => ({
      ...without(item, "capabilityStatus"),
      capabilityStatus: seedDetailedCapabilityStatus(status, item.surfaces, item.testIds, index),
    })),
  })
}

function normalizeFeatureEvidence(matrix: ReturnType<typeof migrateFeatureMatrix>, index: TestEvidenceIndex) {
  return featureMatrixSchema.parse({
    ...matrix,
    features: matrix.features.map((feature) => {
      const candidates = [...feature.testIds, ...feature.plannedTestIds]
      const testIds = candidates.filter((id) => index.has(id))
      const plannedTestIds = candidates.filter((id) => !index.has(id))
      return {
        ...feature,
        testIds,
        plannedTestIds,
        capabilityStatus: plannedTestIds.length && feature.capabilityStatus.evidence === "complete"
          ? { ...feature.capabilityStatus, evidence: "partial" as const }
          : feature.capabilityStatus,
      }
    }),
  })
}

function normalizeDetailedEvidence(checklist: ReturnType<typeof migrateDetailedChecklist>, index: TestEvidenceIndex) {
  return detailedChecklistSchema.parse({
    ...checklist,
    items: checklist.items.map((item) => {
      const candidates = [...item.testIds, ...item.plannedTestIds]
      const testIds = candidates.filter((id) => index.has(id))
      const plannedTestIds = candidates.filter((id) => !index.has(id))
      return {
        ...item,
        testIds,
        plannedTestIds,
        capabilityStatus: plannedTestIds.length && item.capabilityStatus.evidence === "complete"
          ? { ...item.capabilityStatus, evidence: "partial" as const }
          : item.capabilityStatus,
      }
    }),
  })
}

function migrateAcceptanceContract(raw: Record<string, unknown>) {
  const fields = Array.isArray(raw.requiredItemFields) ? raw.requiredItemFields.filter((field) => field !== "status" && field !== "capabilityStatus") : []
  return {
    ...raw,
    schemaVersion: 2,
    capabilityStatus: {
      dimensions: [...CAPABILITY_DIMENSIONS],
      values: ["pending", "partial", "complete", "not-applicable"],
      overall: "Derived only: complete when every applicable dimension is complete; pending when every applicable dimension is pending; partial otherwise. not-applicable dimensions do not affect overall status.",
      applicability: "GUI/CLI/TUI listed in an item's surfaces are required and cannot be not-applicable. Core and transport applicability follows the canonical application/DTO boundary. Evidence is required for every item.",
    },
    requiredItemFields: [...fields, "capabilityStatus"],
  }
}

function seedCardCapabilityStatus(
  status: LegacyCardMatrix["cards"][number]["status"],
  surfaces: readonly ("gui" | "cli" | "tui")[],
): CapabilityStatus {
  const progress = status === "pending" ? "pending" : status === "partial" ? "partial" : "complete"
  return {
    core: "not-applicable",
    transport: "not-applicable",
    gui: surfaces.includes("gui") ? progress : "not-applicable",
    cli: "not-applicable",
    tui: "not-applicable",
    evidence: progress,
  }
}

async function validateOutputs(outputs: ReadonlyMap<string, string>, detailedPaths: readonly string[], itemCount: number): Promise<void> {
  const tempFeature = JSON.parse(outputs.get(featurePath)!) as unknown
  const tempCard = JSON.parse(outputs.get(cardPath)!) as unknown
  const features = featureMatrixSchema.parse(tempFeature)
  const cards = cardMatrixSchema.parse(tempCard)
  if (features.features.length !== 30) throw new Error(`Feature count changed: ${features.features.length} != 30`)
  if (cards.cards.length !== cards.source.cardCount || cards.cards.length !== 77) throw new Error(`Card count changed: ${cards.cards.length} != 77`)
  let parsedItems = 0
  for (const relativePath of detailedPaths) {
    const path = resolve(root, relativePath)
    const parsed = detailedChecklistSchema.parse(JSON.parse(outputs.get(path)!))
    parsedItems += parsed.items.length
  }
  if (parsedItems !== itemCount) throw new Error(`Checklist item count changed: ${parsedItems} != ${itemCount}`)
}

function parseCurrentFeatureMatrix(raw: Record<string, unknown>) {
  return featureMatrixSchema.parse(raw)
}

function parseCurrentCardMatrix(raw: Record<string, unknown>) {
  return cardMatrixSchema.parse(raw)
}

function parseCurrentDetailedChecklist(raw: Record<string, unknown>) {
  return detailedChecklistSchema.parse(raw)
}

function without<T extends Record<string, unknown>, K extends string>(value: T, key: K): Omit<T, K> {
  const copy: Record<string, unknown> = { ...value }
  delete copy[key]
  return copy as Omit<T, K>
}

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function relative(path: string): string {
  return path.slice(root.length + 1).replaceAll("\\", "/")
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T
}
