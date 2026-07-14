import { createHash } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import { relative, resolve } from "node:path"
import { parseSync } from "oxc-parser"

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
const convertedComponents = inventory.components.filter((component) => component.disposition === "converted")
if (convertedComponents.length !== inventory.reactScaffolds.length) {
  errors.push(`converted components (${convertedComponents.length}) differ from React scaffolds (${inventory.reactScaffolds.length})`)
}
for (const scaffold of inventory.reactScaffolds) {
  const parsed = parseSync(scaffold.outputFile, scaffold.content, { lang: "tsx", sourceType: "module", astType: "ts" })
  if (parsed.errors.length) errors.push(`${scaffold.outputFile}: invalid generated TSX: ${parsed.errors.map((error) => error.message).join("; ")}`)
  if (!scaffold.content.includes(`@migrated-from ${scaffold.sourceFile}`)) errors.push(`${scaffold.outputFile}: missing source provenance`)
  if (/from\s+["'](?:svelte|[^"']*\.svelte)["']|\$(?:bindable|derived|effect|props|state)\b/.test(scaffold.content)) {
    errors.push(`${scaffold.outputFile}: generated React scaffold retains Svelte runtime syntax`)
  }
}
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
const expectedFiles = new Set(artifacts.keys())
for (const file of await walkFiles(outputDir)) {
  const name = relative(outputDir, file).replaceAll("\\", "/")
  if (!expectedFiles.has(name)) drift.push(`${name}: unexpected generated artifact`)
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

async function walkFiles(root: string): Promise<string[]> {
  const output: string[] = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name)
    if (entry.isDirectory()) output.push(...await walkFiles(path))
    else if (entry.isFile()) output.push(path)
  }
  return output
}
