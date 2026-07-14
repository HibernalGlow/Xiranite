import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { analyzeSvelteFrontend } from "../packages/svelte-migrate/src/analyze.js"
import { renderSvelteMigrationArtifacts } from "../packages/svelte-migrate/src/generate.js"
import type { FeatureMappingRule, SvelteMigrationConfig } from "../packages/svelte-migrate/src/types.js"

const source = resolve(process.env.NEOVIEW_SOURCE ?? "../ImageAll/NeeWaifu/neoview/neoview-tauri")
const outputDir = resolve("migration/neoview/frontend")
const config = JSON.parse(await readFile(resolve("migration/neoview/frontend-migration.json"), "utf8")) as SvelteMigrationConfig
const matrix = JSON.parse(await readFile(resolve("migration/neoview/feature-compatibility.json"), "utf8")) as {
  sourceRevision: string
  features: Array<{ id: string; legacySourcePatterns: string[] }>
}
const featureMappings: FeatureMappingRule[] = matrix.features.map((feature) => ({
  featureId: feature.id,
  sourcePatterns: feature.legacySourcePatterns,
}))
featureMappings.push(...(config.featureMappings ?? []))
const inventory = await analyzeSvelteFrontend({
  projectRoot: source,
  sourceRoot: config.sourceRoot,
  classificationOverrides: config.classificationOverrides,
  featureMappings,
})

if (inventory.sourceRevision.dirty) {
  throw new Error(`NeoView frontend source is dirty: ${inventory.sourceRevision.dirtyDiffHash}`)
}
const errors: string[] = []
if (inventory.sourceRevision.commit !== matrix.sourceRevision) {
  errors.push(`frontend revision ${inventory.sourceRevision.commit} differs from feature matrix ${matrix.sourceRevision}`)
}
const featureIds = new Set(matrix.features.map((feature) => feature.id))
for (const mapping of config.featureMappings ?? []) {
  if (!featureIds.has(mapping.featureId)) errors.push(`unknown configured feature id: ${mapping.featureId}`)
}
const entries = [...inventory.components, ...inventory.modules]
for (const entry of entries) {
  if (!entry.featureIds.length) errors.push(`${entry.file}: no feature mapping`)
  for (const featureId of entry.featureIds) if (!featureIds.has(featureId)) errors.push(`${entry.file}: unknown feature id ${featureId}`)
  if (entry.parseErrors.length) errors.push(`${entry.file}: AST parse errors: ${entry.parseErrors.join("; ")}`)
  if (entry.disposition === "converted" && entry.tauriCalls.length) errors.push(`${entry.file}: converted entry still calls Tauri`)
  if ((entry.disposition === "replaced" || entry.disposition === "blocked") && entry.classificationSource !== "config-override") {
    errors.push(`${entry.file}: ${entry.disposition} requires an explicit reviewed override`)
  }
}
for (const usage of inventory.tauriUsage) if (!usage.featureIds.length) errors.push(`${usage.file}: Tauri usage has no feature mapping`)
for (const override of config.classificationOverrides ?? []) {
  const pattern = new RegExp(override.pattern)
  if (!entries.some((entry) => pattern.test(entry.file))) errors.push(`classification override matches no source: ${override.pattern}`)
}
if (errors.length) throw new Error(`NeoView frontend inventory validation failed:\n- ${errors.join("\n- ")}`)
const artifacts = renderSvelteMigrationArtifacts(inventory)
const drift: string[] = []
for (const [name, expected] of artifacts) {
  const current = await readFile(resolve(outputDir, name), "utf8").catch(() => null)
  if (current === expected) continue
  drift.push(`${name}: committed=${digest(current ?? "<missing>")} generated=${digest(expected)}`)
}
if (drift.length) {
  throw new Error(
    `NeoView frontend AST inventory drifted:\n- ${drift.join("\n- ")}\n` +
    `Run bun run generate:neoview-frontend-inventory and review every disposition/source mapping change.`,
  )
}

process.stdout.write(
  `NeoView frontend inventory valid: ${inventory.summary.components} components, ${inventory.summary.modules} modules, ` +
  `${inventory.summary.stores} stores, ` +
  `${inventory.summary.graphEdges} edges, ${inventory.summary.tauriCalls} Tauri calls, revision ${inventory.sourceRevision.commit}.\n`,
)

function digest(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16)
}
