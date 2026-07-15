import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

type ChecklistStatus = "pending" | "partial" | "complete"

interface ChecklistItem {
  id: string
  category: string
  title: string
  sourceEvidence: string[]
  targetContract: string
  surfaces: Array<"GUI" | "CLI" | "TUI">
  status: ChecklistStatus
  testIds: string[]
  notes: string
}

interface CardChecklist {
  schemaVersion: 1
  featureId: string
  legacyCardId: string
  sourceRoot: string
  statusValues: ChecklistStatus[]
  completionRule: string
  items: ChecklistItem[]
}

interface AcceptanceContract {
  schemaVersion: 1
  scope: { cardCount: number; inventory: string }
  requiredItemFields: Array<keyof ChecklistItem>
  requiredDimensions: Array<{ id: string; requirement: string }>
  completionGate: string[]
}

const root = resolve(import.meta.dir, "..")
const checklist = await readJson<CardChecklist>(resolve(root, "migration/neoview/folder-main-compatibility.json"))
const contract = await readJson<AcceptanceContract>(resolve(root, "migration/neoview/card-acceptance-contract.json"))
const cardMatrix = await readJson<{ cards: Array<{
  legacyId: string
  status: string
  sourceComponent?: string
  sourceDisposition?: "component" | "registry-only"
  sourceNotes?: string
}> }>(resolve(root, contract.scope.inventory))
const functionalScopes = await readJson<{ cards: Array<{
  legacyId: string
  capabilities: string[]
  checklistRef?: string
}> }>(resolve(root, "migration/neoview/card-functional-scopes.json"))
const inventory = await readJson<{ modules: Array<{ file: string }> }>(resolve(root, "migration/neoview/frontend/module-inventory.json"))
const componentInventory = await readJson<{ components: Array<{ file: string }> }>(resolve(root, "migration/neoview/frontend/component-inventory.json"))
const errors: string[] = []

if (checklist.schemaVersion !== 1) errors.push(`unsupported checklist schema ${String(checklist.schemaVersion)}`)
if (contract.schemaVersion !== 1) errors.push(`unsupported acceptance contract schema ${String(contract.schemaVersion)}`)
if (contract.scope.cardCount !== cardMatrix.cards.length) errors.push(`acceptance scope card count ${contract.scope.cardCount} != ${cardMatrix.cards.length}`)
if (!contract.requiredDimensions.length) errors.push("acceptance contract has no required dimensions")
if (!contract.completionGate.length) errors.push("acceptance contract has no completion gate")

const scopeIds = new Set<string>()
const matrixIds = new Set(cardMatrix.cards.map((card) => card.legacyId))
for (const scope of functionalScopes.cards) {
  if (scopeIds.has(scope.legacyId)) errors.push(`duplicate functional scope ${scope.legacyId}`)
  scopeIds.add(scope.legacyId)
  if (!matrixIds.has(scope.legacyId)) errors.push(`functional scope references unknown Card ${scope.legacyId}`)
  if (!scope.capabilities.length || scope.capabilities.some((capability) => !capability.trim())) {
    errors.push(`${scope.legacyId} has an empty functional capability scope`)
  }
}
for (const card of cardMatrix.cards) {
  if (!scopeIds.has(card.legacyId)) errors.push(`${card.legacyId} has no frozen functional scope`)
}
const folderScope = functionalScopes.cards.find((scope) => scope.legacyId === checklist.legacyCardId)
if (folderScope?.checklistRef !== "migration/neoview/folder-main-compatibility.json") {
  errors.push(`${checklist.legacyCardId} does not reference its detailed checklist`)
}

const sourcePrefix = "src/lib/components/panels/folderPanel/"
const sourceFiles = new Set([
  ...inventory.modules.map((entry) => entry.file),
  ...componentInventory.components.map((entry) => entry.file),
])
const ids = new Set<string>()
const allowedStatuses = new Set(checklist.statusValues)
const allowedSurfaces = new Set(["GUI", "CLI", "TUI"])

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

for (const item of checklist.items) {
  if (ids.has(item.id)) errors.push(`duplicate checklist item ${item.id}`)
  ids.add(item.id)
  for (const field of contract.requiredItemFields) {
    if (!(field in item)) errors.push(`${item.id} is missing ${field}`)
  }
  if (!item.id.trim() || !item.category.trim() || !item.title.trim()) errors.push(`${item.id || "<missing id>"} has blank identity fields`)
  if (!item.targetContract.trim()) errors.push(`${item.id} has no target contract`)
  if (!allowedStatuses.has(item.status)) errors.push(`${item.id} has invalid status ${item.status}`)
  if (!item.sourceEvidence.length) errors.push(`${item.id} has no source evidence`)
  if (!item.surfaces.length || item.surfaces.some((surface) => !allowedSurfaces.has(surface))) errors.push(`${item.id} has invalid surfaces`)
  if (item.status === "complete" && !item.testIds.length) errors.push(`${item.id} is complete without automated test IDs`)
  for (const evidence of item.sourceEvidence) {
    if (!sourceFiles.has(`${sourcePrefix}${evidence}`)) errors.push(`${item.id} references source missing from frozen inventory: ${evidence}`)
  }
}

const legacyCard = cardMatrix.cards.find((card) => card.legacyId === checklist.legacyCardId)
if (!legacyCard) errors.push(`legacy card ${checklist.legacyCardId} is missing from card matrix`)
const incomplete = checklist.items.filter((item) => item.status !== "complete")
if (legacyCard?.status === "migrated" && incomplete.length) errors.push(`${checklist.legacyCardId} is migrated while ${incomplete.length} checklist items remain incomplete`)
if (process.argv.includes("--require-complete")) {
  for (const item of incomplete) errors.push(`${item.id} remains ${item.status}`)
}

if (errors.length) {
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log(JSON.stringify({
  legacyCardId: checklist.legacyCardId,
  total: checklist.items.length,
  byStatus: counts(checklist.items.map((item) => item.status)),
  byCategory: counts(checklist.items.map((item) => item.category)),
  acceptanceDimensions: contract.requiredDimensions.length,
  functionalScopes: functionalScopes.cards.length,
  cardSourceComponents: cardMatrix.cards.filter((card) => card.sourceDisposition === "component").length,
  registryOnlyCards: cardMatrix.cards.filter((card) => card.sourceDisposition === "registry-only").map((card) => card.legacyId),
}, null, 2))

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T
}

function counts(values: string[]): Record<string, number> {
  const result: Record<string, number> = {}
  for (const value of values) result[value] = (result[value] ?? 0) + 1
  return result
}
