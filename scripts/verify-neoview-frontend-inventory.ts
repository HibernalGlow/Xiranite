import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { analyzeSvelteFrontend } from "../packages/svelte-migrate/src/analyze.js"
import { renderSvelteMigrationArtifacts } from "../packages/svelte-migrate/src/generate.js"
import type { SvelteMigrationConfig } from "../packages/svelte-migrate/src/types.js"

const source = resolve(process.env.NEOVIEW_SOURCE ?? "../ImageAll/NeeWaifu/neoview/neoview-tauri")
const outputDir = resolve("migration/neoview/frontend")
const config = JSON.parse(await readFile(resolve("migration/neoview/frontend-migration.json"), "utf8")) as SvelteMigrationConfig
const inventory = await analyzeSvelteFrontend({
  projectRoot: source,
  sourceRoot: config.sourceRoot,
  classificationOverrides: config.classificationOverrides,
})

if (inventory.sourceRevision.dirty) {
  throw new Error(`NeoView frontend source is dirty: ${inventory.sourceRevision.dirtyDiffHash}`)
}
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
  `NeoView frontend inventory valid: ${inventory.summary.components} components, ${inventory.summary.stores} stores, ` +
  `${inventory.summary.graphEdges} edges, ${inventory.summary.tauriCalls} Tauri calls, revision ${inventory.sourceRevision.commit}.\n`,
)

function digest(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16)
}
