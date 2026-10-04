#!/usr/bin/env node
import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { analyzeNodePackages } from "./node-feasibility.js"
import { generateMigrationArtifacts } from "./generate.js"
import { portTauriFrontend } from "./frontend.js"
import type { TauriMigrationConfig } from "./types.js"

export async function runTauriMigrationCli(args = process.argv.slice(2)): Promise<void> {
  if (args.includes("--help") || args.includes("-h") || args.length === 0) {
    process.stdout.write(help())
    return
  }

  const command = args[0]
  if (command === "frontend") {
    const sourceRoot = positional(args, 1)
    const outputDir = value(args, "--out")
    if (!sourceRoot || !outputDir) throw new Error("Both <source-root> and --out <directory> are required.")
    const configPath = value(args, "--config")
    const config = configPath ? JSON.parse(await readFile(resolve(configPath), "utf8")) : {}
    const manifest = await portTauriFrontend({ sourceRoot, outputDir, ...config, force: args.includes("--force") })
    process.stdout.write(`Tauri frontend port: ${manifest.summary.sourceFiles} source file(s), ${manifest.summary.rewrittenImports} import rewrite(s), ${manifest.summary.tauriImportFiles} Tauri adapter file(s).\n`)
    return
  }
  if (command === "feasibility") {
    const repoRoot = resolve(positional(args, 1) ?? ".")
    const output = resolve(value(args, "--out") ?? join(repoRoot, "artifacts", "node-wasm-feasibility.json"))
    const report = await analyzeNodePackages({
      repoRoot,
      nodeIds: values(args, "--node"),
      blockedNative: values(args, "--blocked-native"),
      rustHostOnly: values(args, "--rust-host-only"),
    })
    if (!args.includes("--force") && existsSync(output)) {
      throw new Error(`Refusing to overwrite ${output}. Pass --force to replace the feasibility artifact.`)
    }
    await mkdir(dirname(output), { recursive: true })
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`)
    process.stdout.write(
      `Node WASM feasibility: ${report.nodes.length} node(s) -> ` +
        `${report.summary["wasm-plugin"]} plugin, ${report.summary["wasm-with-host-io"]} plugin+host-io, ` +
        `${report.summary["rust-host"]} Rust host, ${report.summary["blocked-native"]} blocked-native, ` +
        `${report.summary["manual-review"]} manual review.\nWrote ${relative(repoRoot, output)}\n`,
    )
    return
  }
  if (command !== "generate") {
    throw new Error(`Unknown command ${JSON.stringify(command)}. Expected "generate", "frontend" or "feasibility".`)
  }
  const projectRoot = positional(args, 1)
  const outputDir = value(args, "--out")
  if (!projectRoot || !outputDir) {
    throw new Error("Both <project-root> and --out <directory> are required.")
  }

  const configPath = value(args, "--config")
  const config = configPath
    ? JSON.parse(await readFile(resolve(configPath), "utf8")) as TauriMigrationConfig
    : {}
  const inventory = await generateMigrationArtifacts({
    projectRoot: resolve(projectRoot),
    outputDir: resolve(outputDir),
    sourceRoots: values(args, "--source") ?? config.sourceRoots,
    nativeMarkers: [...(config.nativeMarkers ?? []), ...(values(args, "--native-marker") ?? [])],
    commandOverrides: config.commandOverrides,
    force: args.includes("--force"),
  })
  process.stdout.write(
    `Tauri migration inventory: ${inventory.commands.length} command(s), ` +
      `${inventory.summary["typescript-portable"]} TypeScript-portable, ` +
      `${inventory.summary["native-required"]} native-required.\n`,
  )
}

function positional(args: string[], index: number): string | undefined {
  return args[index]?.startsWith("-") ? undefined : args[index]
}

function value(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

function values(args: string[], flag: string): string[] | undefined {
  const result: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1]) result.push(args[index + 1]!)
  }
  return result.length ? result : undefined
}

function help(): string {
  return [
    "AST-driven Tauri backend inventory and migration scaffolding.",
    "",
    "Usage:",
    "  xiranite-tauri-migrate generate <project-root> --out <directory> [options]",
    "  xiranite-tauri-migrate frontend <source-root> --out <directory> [options]",
    "  xiranite-tauri-migrate feasibility [repo-root] [--out <file>] [options]",
    "",
    "Options:",
    "  --source <directory>       Rust source root; repeatable; auto-detected by default",
    "  --config <file>            Project decisions (markers, source roots, command overrides)",
    "  --native-marker <text>     Additional native dependency evidence; repeatable",
    "  --node <id>                Restrict the feasibility scan to this node id; repeatable",
    "  --blocked-native <spec>    Extra specifier that blocks WASM packaging; repeatable",
    "  --rust-host-only <spec>    Extra specifier that must stay in the Rust host; repeatable",
    "  --force                    Replace files in the generated output directory",
    "  -h, --help                 Show this help",
    "",
  ].join("\n")
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runTauriMigrationCli().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
