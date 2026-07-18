import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { READER_CARD_MANIFEST } from "../packages/nodes/neoview/src/application/config/ReaderLayoutManifest"
import {
  blockedDimensions,
  deriveOverallStatus,
  overallCounts,
  parseCardMatrix,
  parseFeatureMatrix,
  statusCounts,
} from "./lib/neoview-capability-status"

type CardPriority = "core" | "integration" | "deferred"

const root = resolve(import.meta.dir, "..")
const matrix = await parseCardMatrix(resolve(root, "migration/neoview/card-compatibility.json"))
const moduleInventory = JSON.parse(await readFile(resolve(root, "migration/neoview/frontend/module-inventory.json"), "utf8")) as { modules: Array<{ file: string; hash: string }> }
const featureMatrix = await parseFeatureMatrix(resolve(root, "migration/neoview/feature-compatibility.json"))
const errors: string[] = []

const sourceInventory = moduleInventory.modules.find((entry) => entry.file === matrix.source.file)
if (!sourceInventory) errors.push(`legacy registry ${matrix.source.file} is missing from module inventory`)
else if (sourceInventory.hash !== matrix.source.hash) errors.push(`legacy registry hash drifted: ${matrix.source.hash} != ${sourceInventory.hash}`)
if (matrix.cards.length !== matrix.source.cardCount) errors.push(`card count mismatch: ${matrix.cards.length} != ${matrix.source.cardCount}`)

const legacyIds = new Set<string>()
const currentIds = new Set(READER_CARD_MANIFEST.map((card) => card.id as string))
const mappedCurrentIds = new Set<string>()
const featureIds = new Set(featureMatrix.features.map((feature) => feature.id))
const allowedPriorities = new Set<CardPriority>(matrix.priorities)

for (const card of matrix.cards) {
  if (legacyIds.has(card.legacyId)) errors.push(`duplicate legacy card ${card.legacyId}`)
  legacyIds.add(card.legacyId)
  if (!allowedPriorities.has(card.priority)) errors.push(`legacy card ${card.legacyId} has invalid priority ${card.priority}`)
  if (!featureIds.has(card.featureId)) errors.push(`legacy card ${card.legacyId} references unknown feature ${card.featureId}`)
  if (card.currentCardId) {
    if (!currentIds.has(card.currentCardId)) errors.push(`legacy card ${card.legacyId} maps to unknown current card ${card.currentCardId}`)
    mappedCurrentIds.add(card.currentCardId)
  }
  const overall = deriveOverallStatus(card.capabilityStatus)
  if (overall !== "pending" && !card.currentCardId && card.disposition === "migrate") {
    errors.push(`legacy card ${card.legacyId} is ${overall} without a current card mapping`)
  }
  if (card.disposition === "replace" && !card.replacement) errors.push(`legacy card ${card.legacyId} is replaced without replacement evidence`)
}

for (const currentId of currentIds) {
  if (!mappedCurrentIds.has(currentId)) errors.push(`current card ${currentId} has no legacy compatibility mapping`)
}

if (process.argv.includes("--require-complete")) {
  for (const card of matrix.cards) {
    const overall = deriveOverallStatus(card.capabilityStatus)
    if (overall !== "complete") errors.push(`legacy card ${card.legacyId} remains ${overall} (${blockedDimensions(card.capabilityStatus).join(", ")})`)
  }
}

if (errors.length) {
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log(JSON.stringify({
  sourceCards: matrix.cards.length,
  currentCards: currentIds.size,
  byOverall: overallCounts(matrix.cards.map((card) => card.capabilityStatus)),
  byDimension: statusCounts(matrix.cards.map((card) => card.capabilityStatus)),
  byPriority: counts(matrix.cards.map((card) => card.priority)),
}, null, 2))

function counts(values: string[]): Record<string, number> {
  const result: Record<string, number> = {}
  for (const value of values) result[value] = (result[value] ?? 0) + 1
  return result
}
