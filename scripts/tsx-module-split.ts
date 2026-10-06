#!/usr/bin/env bun
import { readFile, stat, unlink, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

import { analyzeTsxModule, relativeSplitPath, splitTsxModule } from "./lib/tsx-module-split"

const root = process.cwd()

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  printHelp()
  process.exit(0)
}

const file = resolve(root, requireValue("--file"))
const source = await readFile(file, "utf8")
const targetValue = optionValue("--target")
const symbolValue = optionValue("--symbols")
if (!targetValue && !symbolValue) {
  console.log(JSON.stringify(analyzeTsxModule(source, relativeSplitPath(root, file)), null, 2))
  process.exit(0)
}
if (!targetValue || !symbolValue) throw new Error("--target and --symbols must be provided together.")

const target = resolve(root, targetValue)
const result = splitTsxModule(
  source,
  relativeSplitPath(root, file),
  relativeSplitPath(root, target),
  symbolValue.split(",").map((value) => value.trim()).filter(Boolean),
)

if (process.argv.includes("--write")) {
  if (await exists(target)) throw new Error(`Target already exists: ${relativeSplitPath(root, target)}`)
  await writeFile(target, result.module, { encoding: "utf8", flag: "wx" })
  try {
    await writeFile(file, result.source, "utf8")
  } catch (cause) {
    await unlink(target).catch(() => undefined)
    throw cause
  }
}
console.log(JSON.stringify({ ...result.report, wrote: process.argv.includes("--write") }, null, 2))

function optionValue(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

function requireValue(name: string): string {
  const value = optionValue(name)
  if (!value) throw new Error(`${name} requires a value.`)
  return value
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function printHelp(): void {
  console.log([
    "Usage:",
    "  bun scripts/tsx-module-split.ts --file <source.tsx>",
    "  bun scripts/tsx-module-split.ts --file <source.tsx> --target <module.tsx> --symbols <a,b> [--write]",
    "",
    "Without a target, prints the OXC declaration/dependency inventory.",
    "Extraction is dry-run by default and currently requires a same-directory target.",
    "The tool refuses partial declarations and retained local dependencies, preserves public re-exports,",
    "and reparses both generated modules before --write changes the filesystem.",
  ].join("\n"))
}
