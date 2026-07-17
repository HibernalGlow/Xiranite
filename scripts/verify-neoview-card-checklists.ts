import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import {
  CAPABILITY_DIMENSIONS,
  aggregateCapabilityStatuses,
  blockedDimensions,
  buildTestEvidenceIndex,
  deriveOverallStatus,
  overallCounts,
  parseCardMatrix,
  parseDetailedChecklist,
  statusCounts,
  type CapabilityDimension,
  type CapabilityStatus,
  type DetailedChecklist,
  type TestEvidenceIndex,
} from "./lib/neoview-capability-status"

interface AcceptanceContract {
  schemaVersion: 2
  scope: { cardCount: number; inventory: string }
  capabilityStatus: { dimensions: string[]; values: string[]; overall: string; applicability: string }
  requiredItemFields: string[]
  requiredDimensions: Array<{ id: string; requirement: string }>
  completionGate: string[]
}

interface FunctionalScope {
  legacyId: string
  capabilities: string[]
  checklistRef?: string
}

const root = resolve(import.meta.dir, "..")
const contract = await readJson<AcceptanceContract>(resolve(root, "migration/neoview/card-acceptance-contract.json"))
const cardMatrix = await parseCardMatrix(resolve(root, contract.scope.inventory))
const functionalScopes = await readJson<{ cards: FunctionalScope[] }>(resolve(root, "migration/neoview/card-functional-scopes.json"))
const checklistByRef = new Map<string, DetailedChecklist>()
for (const scope of functionalScopes.cards) {
  if (!scope.checklistRef || checklistByRef.has(scope.checklistRef)) continue
  checklistByRef.set(scope.checklistRef, await parseDetailedChecklist(resolve(root, scope.checklistRef)))
}
const inventory = await readJson<{ modules: Array<{ file: string }> }>(resolve(root, "migration/neoview/frontend/module-inventory.json"))
const componentInventory = await readJson<{ components: Array<{ file: string }> }>(resolve(root, "migration/neoview/frontend/component-inventory.json"))
const evidence = await buildTestEvidenceIndex(root)
const errors: string[] = []

if (contract.schemaVersion !== 2) errors.push(`unsupported acceptance contract schema ${String(contract.schemaVersion)}`)
if (contract.scope.cardCount !== cardMatrix.cards.length) errors.push(`acceptance scope card count ${contract.scope.cardCount} != ${cardMatrix.cards.length}`)
if (contract.capabilityStatus.dimensions.join(",") !== CAPABILITY_DIMENSIONS.join(",")) errors.push("acceptance contract capability dimensions differ from the shared schema")
if (!contract.requiredDimensions.length) errors.push("acceptance contract has no required dimensions")
if (!contract.completionGate.length) errors.push("acceptance contract has no completion gate")

const scopeIds = new Set<string>()
const matrixIds = new Set(cardMatrix.cards.map((card) => card.legacyId))
for (const scope of functionalScopes.cards) {
  if (scopeIds.has(scope.legacyId)) errors.push(`duplicate functional scope ${scope.legacyId}`)
  scopeIds.add(scope.legacyId)
  if (!matrixIds.has(scope.legacyId)) errors.push(`functional scope references unknown Card ${scope.legacyId}`)
  if (!scope.capabilities.length || scope.capabilities.some((capability) => !capability.trim())) errors.push(`${scope.legacyId} has an empty functional capability scope`)
  if (scope.checklistRef) {
    const detailed = checklistByRef.get(scope.checklistRef)
    if (!detailed) errors.push(`${scope.legacyId} detailed checklist could not be loaded: ${scope.checklistRef}`)
    else if (detailed.legacyCardId !== scope.legacyId) errors.push(`${scope.checklistRef} belongs to ${detailed.legacyCardId}, not ${scope.legacyId}`)
  }
}
for (const card of cardMatrix.cards) {
  if (!scopeIds.has(card.legacyId)) errors.push(`${card.legacyId} has no frozen functional scope`)
}

const sourceFiles = new Set([
  ...inventory.modules.map((entry) => entry.file),
  ...componentInventory.components.map((entry) => entry.file),
])
for (const card of cardMatrix.cards) {
  if (card.sourceDisposition === "component") {
    if (!card.sourceComponent) errors.push(`${card.legacyId} has component disposition without sourceComponent`)
    else if (!sourceFiles.has(card.sourceComponent)) errors.push(`${card.legacyId} references source component missing from frozen inventory: ${card.sourceComponent}`)
  } else if (card.sourceDisposition === "registry-only") {
    if (card.sourceComponent) errors.push(`${card.legacyId} is registry-only but still has sourceComponent`)
    if (!card.sourceNotes?.trim()) errors.push(`${card.legacyId} is registry-only without an explicit migration decision note`)
  } else {
    errors.push(`${card.legacyId} has no source disposition`)
  }
}

const allItems = [] as DetailedChecklist["items"]
const allGroups = [] as DetailedChecklist["sourceUiInventory"]
for (const [checklistRef, detailed] of checklistByRef) {
  validateDetailedChecklist(detailed, checklistRef, evidence)
  allItems.push(...detailed.items)
  allGroups.push(...detailed.sourceUiInventory)
  const card = cardMatrix.cards.find((entry) => entry.legacyId === detailed.legacyCardId)
  if (!card) {
    errors.push(`${checklistRef} references missing Card ${detailed.legacyCardId}`)
    continue
  }
  const aggregate = aggregateCapabilityStatuses(detailed.items.map((item) => item.capabilityStatus))
  if (!sameStatus(card.capabilityStatus, aggregate)) {
    errors.push(`${detailed.legacyCardId} Card capabilityStatus differs from detailed checklist aggregation`)
  }
}

if (process.argv.includes("--require-complete")) {
  for (const [checklistRef, detailed] of checklistByRef) {
    for (const item of detailed.items) {
      const overall = deriveOverallStatus(item.capabilityStatus)
      if (overall !== "complete") errors.push(`${checklistRef}:${item.id} remains ${overall} (${blockedDimensions(item.capabilityStatus).join(", ")})`)
    }
  }
}

if (errors.length) {
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

const folder = [...checklistByRef.values()].find((value) => value.legacyCardId === "folderMain")
console.log(JSON.stringify({
  detailedChecklists: [...checklistByRef.keys()],
  checklistItems: allItems.length,
  byOverall: overallCounts(allItems.map((item) => item.capabilityStatus)),
  byDimension: statusCounts(allItems.map((item) => item.capabilityStatus)),
  acceptanceDimensions: contract.requiredDimensions.length,
  sourceUiInventoryGroups: allGroups.length,
  sourceUiInventoryItems: allGroups.reduce((total, group) => total + group.acceptanceItems.length, 0),
  folderMain: folder ? {
    total: folder.items.length,
    byOverall: overallCounts(folder.items.map((item) => item.capabilityStatus)),
    byCategory: counts(folder.items.map((item) => item.category)),
  } : null,
  functionalScopes: functionalScopes.cards.length,
  cardSourceComponents: cardMatrix.cards.filter((card) => card.sourceDisposition === "component").length,
  registryOnlyCards: cardMatrix.cards.filter((card) => card.sourceDisposition === "registry-only").map((card) => card.legacyId),
}, null, 2))

function validateDetailedChecklist(detailed: DetailedChecklist, checklistRef: string, index: TestEvidenceIndex): void {
  const itemIds = new Set<string>()
  const groupIds = new Set<string>()
  for (const item of detailed.items) {
    if (itemIds.has(item.id)) errors.push(`${checklistRef} has duplicate item ${item.id}`)
    itemIds.add(item.id)
    for (const field of contract.requiredItemFields) {
      if (!(field in item)) errors.push(`${checklistRef}:${item.id} is missing ${field}`)
    }
    for (const surface of item.surfaces) {
      const dimension = surface.toLocaleLowerCase() as "gui" | "cli" | "tui"
      if (item.capabilityStatus[dimension] === "not-applicable") errors.push(`${checklistRef}:${item.id} requires ${surface} but marks it not-applicable`)
    }
    if (item.capabilityStatus.evidence === "not-applicable") errors.push(`${checklistRef}:${item.id} cannot mark evidence not-applicable`)
    for (const testId of item.testIds) {
      if (!index.has(testId)) errors.push(`${checklistRef}:${item.id} references missing tracked test [${testId}]`)
    }
    if (item.plannedTestIds.length && item.capabilityStatus.evidence === "complete") {
      errors.push(`${checklistRef}:${item.id} evidence is complete while planned tests remain: ${item.plannedTestIds.join(", ")}`)
    }
    validateCompletedEvidence(checklistRef, item.id, item.capabilityStatus, item.testIds, index)
    for (const source of item.sourceEvidence) validateDetailedEvidence(detailed, checklistRef, item.id, source)
  }
  for (const group of detailed.sourceUiInventory) {
    if (groupIds.has(group.id)) errors.push(`${checklistRef} has duplicate source UI group ${group.id}`)
    groupIds.add(group.id)
    for (const source of group.sourceEvidence) validateDetailedEvidence(detailed, checklistRef, group.id, source)
    for (const itemId of group.mappedChecklistIds) {
      if (!itemIds.has(itemId)) errors.push(`${checklistRef}:${group.id} maps to unknown item ${itemId}`)
    }
  }
}

function validateCompletedEvidence(
  checklistRef: string,
  itemId: string,
  status: CapabilityStatus,
  testIds: readonly string[],
  index: TestEvidenceIndex,
): void {
  const covered = index.dimensions(testIds)
  for (const dimension of CAPABILITY_DIMENSIONS) {
    if (status[dimension] !== "complete") continue
    if (dimension === "evidence") {
      if (!testIds.length) errors.push(`${checklistRef}:${itemId} evidence is complete without test IDs`)
      continue
    }
    if (!covered.has(dimension)) errors.push(`${checklistRef}:${itemId} marks ${dimension} complete without dimension-specific tracked evidence`)
  }
}

function validateDetailedEvidence(detailed: DetailedChecklist, checklistRef: string, id: string, source: string): void {
  const sourcePath = detailedSourcePath(detailed.sourceRoot, source)
  if (!sourceFiles.has(sourcePath)) errors.push(`${checklistRef}:${id} references source missing from frozen inventory: ${sourcePath}`)
}

function detailedSourcePath(sourceRoot: string, source: string): string {
  const normalizedRoot = sourceRoot.replaceAll("\\", "/").replace(/\/$/, "")
  const marker = "/neoview-tauri"
  const markerIndex = normalizedRoot.toLocaleLowerCase().lastIndexOf(marker)
  const prefix = markerIndex === -1 ? "" : normalizedRoot.slice(markerIndex + marker.length).replace(/^\//, "")
  return [prefix, source.replaceAll("\\", "/")].filter(Boolean).join("/")
}

function sameStatus(left: CapabilityStatus, right: CapabilityStatus): boolean {
  return CAPABILITY_DIMENSIONS.every((dimension) => left[dimension] === right[dimension])
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T
}

function counts(values: string[]): Record<string, number> {
  const result: Record<string, number> = {}
  for (const value of values) result[value] = (result[value] ?? 0) + 1
  return result
}
