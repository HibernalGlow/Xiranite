#!/usr/bin/env bun
/**
 * `make-dissolvef-fixtures` — durable, re-creatable directory trees for driving `dissolvef` by hand.
 *
 * Why this exists: `dissolvef` is a destructive node. A `nested`/`media`/`archive` run moves files up and
 * deletes the directories it emptied, so a fixture you point at once is *gone* after a successful run — and
 * the tests that assert that behaviour clean up after themselves. To try the node in the CLI, the TUI or the
 * GUI you need trees that live somewhere stable and that you can get back with one command. That is what
 * this writes: named fixtures under `artifacts/dissolvef-fixtures/` (gitignored, and *not* inside
 * `artifacts/node-bundles/`, which `build:node-bundles` wipes), rebuilt deterministically from this file.
 *
 * Usage:
 *   bun scripts/make-dissolvef-fixtures.ts                 # create whatever is missing, leave the rest
 *   bun scripts/make-dissolvef-fixtures.ts --reset         # rebuild every fixture from scratch
 *   bun scripts/make-dissolvef-fixtures.ts --only nested-empty-deep --reset
 *   bun scripts/make-dissolvef-fixtures.ts --list          # names + one-line what-it-tests
 *   bun scripts/make-dissolvef-fixtures.ts --print-path nested-empty-deep   # just the path, for shell use
 *
 * Then grant the parent to the host and point a face at one tree:
 *   XIRANITE_ALLOWED_DIRS="$PWD/artifacts/dissolvef-fixtures" bun run dev:desktop
 *
 * Empty directories are the point of several of these, so the generator writes a `.gitkeep`-free tree on
 * purpose: nothing here may depend on a file being present to keep the directory alive.
 */
import { mkdir, rm, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { argv, exit, stdout } from "node:process"

import { fixtures } from "./dissolvef-fixture-trees.ts"

const repoRoot = resolve(dirname(argv[1] ?? "."), "..")
const outRoot = join(repoRoot, "artifacts", "dissolvef-fixtures")

interface Options {
  reset: boolean
  only: string | null
  list: boolean
  printPath: string | null
}

function parseArgs(raw: string[]): Options {
  const flagValue = (name: string): string | null => {
    const index = raw.indexOf(`--${name}`)
    return index >= 0 ? raw[index + 1] ?? null : null
  }
  const printPath = flagValue("print-path")
  if (printPath !== null && !fixtures.some((entry) => entry.name === printPath)) {
    throw new Error(`--print-path needs a fixture name; ${available()}`)
  }
  const only = flagValue("only")
  if (only !== null && !fixtures.some((entry) => entry.name === only)) {
    throw new Error(`--only needs a fixture name; ${available()}`)
  }
  return { reset: raw.includes("--reset"), only, list: raw.includes("--list"), printPath }
}

function available(): string {
  return `available: ${fixtures.map((entry) => entry.name).join(", ")}`
}

/** One line per file, so `tree`-less platforms can still see what was built. */
async function writeTree(root: string, files: Record<string, string>): Promise<number> {
  let written = 0
  for (const [relative, content] of Object.entries(files)) {
    const target = join(root, relative)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
    written += 1
  }
  return written
}

async function build(name: string): Promise<{ root: string; files: number; dirs: number }> {
  const entry = fixtures.find((candidate) => candidate.name === name)
  if (entry === undefined) throw new Error(`no fixture named ${name}; ${available()}`)
  const root = join(outRoot, name)
  await rm(root, { recursive: true, force: true })
  // `mkdir` before the dirs list, because several fixtures are *only* empty directories and nothing else
  // would create the root.
  await mkdir(root, { recursive: true })
  for (const directory of entry.dirs) await mkdir(join(root, directory), { recursive: true })
  const files = await writeTree(root, entry.files)
  return { root, files, dirs: entry.dirs.length }
}

async function main(): Promise<number> {
  const options = parseArgs(argv.slice(2))

  if (options.list) {
    for (const entry of fixtures) console.log(`${entry.name}\t${entry.tests}`)
    return 0
  }
  if (options.printPath !== null) {
    stdout.write(join(outRoot, options.printPath) + "\n")
    return 0
  }

  await mkdir(outRoot, { recursive: true })
  const selected = options.only === null ? fixtures.map((entry) => entry.name) : [options.only]
  for (const name of selected) {
    const exists = options.only === null && !options.reset && (await existsAlready(name))
    if (exists) {
      console.log(`keep  ${name} (untouched; --reset to rebuild)`)
      continue
    }
    const built = await build(name)
    console.log(`built ${name}  dirs=${built.dirs} files=${built.files}  ${built.root}`)
    console.log(`      ${fixtures.find((entry) => entry.name === name)?.tests}`)
  }
  console.log(`root: ${outRoot}`)
  console.log(`grant it to a host with XIRANITE_ALLOWED_DIRS="${outRoot}" (one root covers every fixture)`)
  return 0
}

async function existsAlready(name: string): Promise<boolean> {
  try {
    const { stat } = await import("node:fs/promises")
    return (await stat(join(outRoot, name))).isDirectory()
  } catch {
    return false
  }
}

main().then((code) => exit(code)).catch((error: unknown) => {
  console.error(`make-dissolvef-fixtures: ${error instanceof Error ? error.message : String(error)}`)
  exit(2)
})
