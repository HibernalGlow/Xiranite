import { access, mkdir, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"

import { analyzeSvelteFrontend } from "./analyze.js"
import type { GenerateSvelteMigrationOptions, SvelteFrontendInventory } from "./types.js"

export async function generateSvelteMigrationArtifacts(
  options: GenerateSvelteMigrationOptions,
): Promise<SvelteFrontendInventory> {
  const inventory = await analyzeSvelteFrontend(options)
  const outputDir = resolve(options.outputDir)
  const artifacts = renderSvelteMigrationArtifacts(inventory)
  await mkdir(join(outputDir, "tsx-scaffold"), { recursive: true })
  if (!options.force) {
    for (const name of artifacts.keys()) {
      const target = join(outputDir, name)
      if (await exists(target)) throw new Error(`Refusing to overwrite ${target}. Pass --force to replace generated artifacts.`)
    }
  }
  for (const [name, content] of artifacts) {
    await writeFile(join(outputDir, name), content, "utf8")
  }
  return inventory
}

export function renderSvelteMigrationArtifacts(inventory: SvelteFrontendInventory): Map<string, string> {
  const header = {
    schemaVersion: inventory.schemaVersion,
    generator: inventory.generator,
    sourceRevision: inventory.sourceRevision,
    sourceRoot: inventory.sourceRoot,
    summary: inventory.summary,
  }
  return new Map([
    ["component-inventory.json", json({ ...header, components: inventory.components })],
    ["module-inventory.json", json({ ...header, modules: inventory.modules })],
    ["store-inventory.json", json({ ...header, stores: inventory.stores })],
    ["component-graph.json", json({ ...header, graph: inventory.graph })],
    ["tauri-usage.json", json({ ...header, tauriUsage: inventory.tauriUsage })],
    ["REPORT.md", renderReport(inventory)],
    ["tsx-scaffold/README.md", scaffoldReadme(inventory)],
  ])
}

function renderReport(inventory: SvelteFrontendInventory): string {
  const rows = inventory.components.map((component) =>
    `| ${escapeTable(component.file)} | ${component.disposition} | ${component.classificationSource} | ${component.tauriCalls.length} | ${component.runes.join(", ") || "-"} | ${component.classificationReasons.map(escapeTable).join("; ")} |`,
  )
  const blocked = inventory.components.filter((component) => component.parseErrors.length)
  return `# Svelte frontend migration report\n\n` +
    `This report is generated from Svelte compiler and OXC AST evidence. A \`converted\` disposition means structurally suitable for codemod scaffolding; it is not a claim of behavioral parity.\n\n` +
    `- Generator: ${inventory.generator.name} ${inventory.generator.version}\n` +
    `- Source commit: ${inventory.sourceRevision.commit ?? "not a Git worktree"}\n` +
    `- Source dirty: ${inventory.sourceRevision.dirty ? "yes" : "no"}\n` +
    `- Dirty diff hash: ${inventory.sourceRevision.dirtyDiffHash ?? "-"}\n` +
    `- Frontend source files: ${inventory.summary.sourceFiles}\n` +
    `- Svelte components: ${inventory.summary.components}\n` +
    `- TypeScript/JavaScript modules: ${inventory.summary.modules}\n` +
    `- Store/rune modules: ${inventory.summary.stores}\n` +
    `- Component edges: ${inventory.summary.graphEdges}\n` +
    `- Unresolved component imports: ${inventory.summary.unresolvedComponentImports}\n` +
    `- Tauri-using files/calls: ${inventory.summary.tauriFiles}/${inventory.summary.tauriCalls}\n` +
    `- Unmapped components/modules: ${inventory.summary.unmappedComponents}/${inventory.summary.unmappedModules}\n` +
    `- Component dispositions: ${Object.entries(inventory.summary.dispositions).map(([name, count]) => `${name}=${count}`).join(", ")}\n` +
    `- Module dispositions: ${Object.entries(inventory.summary.moduleDispositions).map(([name, count]) => `${name}=${count}`).join(", ")}\n\n` +
    `## Component review queue\n\n` +
    `| Source | Disposition | Classification | Tauri calls | Runes | Reasons |\n` +
    `| --- | --- | --- | ---: | --- | --- |\n${rows.join("\n")}\n\n` +
    `## Parse failures\n\n` +
    `${blocked.length ? blocked.map((component) => `- \`${component.file}\`: ${component.parseErrors.join("; ")}`).join("\n") : "None."}\n`
}

function scaffoldReadme(inventory: SvelteFrontendInventory): string {
  return `# Generated TSX scaffold\n\n` +
    `This directory is reserved for reproducible AST-generated React scaffolds from source commit \`${inventory.sourceRevision.commit ?? "unknown"}\`.\n\n` +
    `Production code must not import this directory. Scaffold generation is enabled only after component dispositions and adapter boundaries are reviewed; do not hand-edit generated files.\n`
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function escapeTable(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ")
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true } catch { return false }
}
