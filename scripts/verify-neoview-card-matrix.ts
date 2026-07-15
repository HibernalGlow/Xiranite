import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { READER_CARD_MANIFEST } from "../packages/nodes/neoview/src/application/config/ReaderLayoutManifest"

type CardStatus = "pending" | "partial" | "migrated" | "replaced"
type CardPriority = "core" | "integration" | "deferred"

interface CardMatrix {
  schemaVersion: 1
  source: { file: string; hash: string; cardCount: number }
  statuses: CardStatus[]
  priorities: CardPriority[]
  cards: Array<{
    legacyId: string
    title: string
    panelId: string
    priority: CardPriority
    featureId: string
    status: CardStatus
    currentCardId?: string
    replacement?: string
  }>
}

const root = resolve(import.meta.dir, "..")
const matrix = await readJson<CardMatrix>(resolve(root, "migration/neoview/card-compatibility.json"))
const moduleInventory = await readJson<{ modules: Array<{ file: string; hash: string }> }>(resolve(root, "migration/neoview/frontend/module-inventory.json"))
const featureMatrix = await readJson<{ features: Array<{ id: string }> }>(resolve(root, "migration/neoview/feature-compatibility.json"))
const errors: string[] = []

if (matrix.schemaVersion !== 1) errors.push(`unsupported card matrix schema ${String(matrix.schemaVersion)}`)
const sourceInventory = moduleInventory.modules.find((entry) => entry.file === matrix.source.file)
if (!sourceInventory) errors.push(`legacy registry ${matrix.source.file} is missing from module inventory`)
else if (sourceInventory.hash !== matrix.source.hash) errors.push(`legacy registry hash drifted: ${matrix.source.hash} != ${sourceInventory.hash}`)
if (matrix.cards.length !== matrix.source.cardCount) errors.push(`card count mismatch: ${matrix.cards.length} != ${matrix.source.cardCount}`)

const legacyIds = new Set<string>()
const currentIds = new Set(READER_CARD_MANIFEST.map((card) => card.id as string))
const mappedCurrentIds = new Set<string>()
const featureIds = new Set(featureMatrix.features.map((feature) => feature.id))
const allowedStatuses = new Set<CardStatus>(matrix.statuses)
const allowedPriorities = new Set<CardPriority>(matrix.priorities)

for (const card of matrix.cards) {
  if (legacyIds.has(card.legacyId)) errors.push(`duplicate legacy card ${card.legacyId}`)
  legacyIds.add(card.legacyId)
  if (!card.title.trim()) errors.push(`legacy card ${card.legacyId} has no title`)
  if (!card.panelId.trim()) errors.push(`legacy card ${card.legacyId} has no panel`)
  if (!allowedStatuses.has(card.status)) errors.push(`legacy card ${card.legacyId} has invalid status ${card.status}`)
  if (!allowedPriorities.has(card.priority)) errors.push(`legacy card ${card.legacyId} has invalid priority ${card.priority}`)
  if (!featureIds.has(card.featureId)) errors.push(`legacy card ${card.legacyId} references unknown feature ${card.featureId}`)
  if (card.currentCardId) {
    if (!currentIds.has(card.currentCardId)) errors.push(`legacy card ${card.legacyId} maps to unknown current card ${card.currentCardId}`)
    mappedCurrentIds.add(card.currentCardId)
  }
  if ((card.status === "partial" || card.status === "migrated") && !card.currentCardId) {
    errors.push(`legacy card ${card.legacyId} is ${card.status} without a current card mapping`)
  }
  if (card.status === "replaced" && !card.replacement) errors.push(`legacy card ${card.legacyId} is replaced without replacement evidence`)
}

for (const currentId of currentIds) {
  if (!mappedCurrentIds.has(currentId)) errors.push(`current card ${currentId} has no legacy compatibility mapping`)
}

if (process.argv.includes("--require-complete")) {
  for (const card of matrix.cards) {
    if (card.status !== "migrated" && card.status !== "replaced") errors.push(`legacy card ${card.legacyId} remains ${card.status}`)
  }
}

if (errors.length) {
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log(JSON.stringify({
  sourceCards: matrix.cards.length,
  currentCards: currentIds.size,
  byStatus: counts(matrix.cards.map((card) => card.status)),
  byPriority: counts(matrix.cards.map((card) => card.priority)),
}, null, 2))

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T
}

function counts(values: string[]): Record<string, number> {
  const result: Record<string, number> = {}
  for (const value of values) result[value] = (result[value] ?? 0) + 1
  return result
}
