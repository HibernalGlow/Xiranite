#!/usr/bin/env node
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { generateSvelteMigrationArtifacts } from "./generate.js"
import type { FeatureMappingRule, SvelteMigrationConfig } from "./types.js"

export async function runSvelteMigrationCli(args = process.argv.slice(2)): Promise<void> {
  if (!args.length || args.includes("--help") || args.includes("-h")) {
    process.stdout.write(help())
    return
  }
  if (args[0] !== "generate") throw new Error(`Unknown command ${JSON.stringify(args[0])}. Expected "generate".`)
  const projectRoot = positional(args, 1)
  const outputDir = value(args, "--out")
  if (!projectRoot || !outputDir) throw new Error("Both <project-root> and --out <directory> are required.")
  const configPath = value(args, "--config")
  const config = configPath ? JSON.parse(await readFile(resolve(configPath), "utf8")) as SvelteMigrationConfig : {}
  const featureMatrixPath = value(args, "--feature-matrix")
  const featureMappings = [
    ...(featureMatrixPath
      ? featureMappingsFromMatrix(JSON.parse(await readFile(resolve(featureMatrixPath), "utf8")) as FeatureMatrixShape)
      : []),
    ...(config.featureMappings ?? []),
  ]
  const inventory = await generateSvelteMigrationArtifacts({
    projectRoot: resolve(projectRoot),
    outputDir: resolve(outputDir),
    sourceRoot: config.sourceRoot,
    classificationOverrides: config.classificationOverrides,
    featureMappings,
    force: args.includes("--force"),
  })
  process.stdout.write(
    `Svelte migration inventory: ${inventory.summary.components} components, ${inventory.summary.stores} stores, ` +
    `${inventory.summary.tauriCalls} Tauri calls, revision ${inventory.sourceRevision.commit ?? "none"}.\n`,
  )
}

function positional(args: string[], index: number): string | undefined {
  return args[index]?.startsWith("-") ? undefined : args[index]
}

function value(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

function help(): string {
  return [
    "AST-driven Svelte frontend inventory and React migration scaffolding.",
    "",
    "Usage:",
    "  xiranite-svelte-migrate generate <project-root> --out <directory> [options]",
    "",
    "Options:",
    "  --config <file>  Classification overrides and source-root settings",
    "  --feature-matrix <file>  Map legacy source patterns to migration feature IDs",
    "  --force          Replace known generated artifacts",
    "  -h, --help       Show this help",
    "",
  ].join("\n")
}

interface FeatureMatrixShape {
  features: Array<{ id: string; legacySourcePatterns: string[] }>
}

function featureMappingsFromMatrix(matrix: FeatureMatrixShape): FeatureMappingRule[] {
  return matrix.features.map((feature) => ({ featureId: feature.id, sourcePatterns: feature.legacySourcePatterns }))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runSvelteMigrationCli().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
