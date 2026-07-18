import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { dirname, resolve } from "node:path"

interface Inventory {
  schemaVersion: number
  generator: { name: string; version: string }
  sourceRevision: {
    vcs: "git" | "none"
    commit: string | null
    dirty: boolean
    dirtyDiffHash: string | null
  }
  rustFiles: number
  commands: Array<Record<string, unknown> & {
    name: string
    location: { file: string; line: number; column: number }
    disposition: string
  }>
  registeredCommands: string[]
  unannotatedRegistrations: string[]
  summary: Record<string, number>
}

const args = process.argv.slice(2)
const inventoryPath = resolve(value("--inventory") ?? "artifacts/tauri-migration/neoview-baseline/inventory.json")
const baselinePath = resolve(value("--baseline") ?? "migration/neoview/inventory-baseline.json")
const update = args.includes("--update")

const inventory = JSON.parse(await readFile(inventoryPath, "utf8")) as Inventory
validateInventory(inventory, update)
const normalized = normalizeInventory(inventory)
const serialized = `${JSON.stringify(normalized, null, 2)}\n`

if (update) {
  await mkdir(dirname(baselinePath), { recursive: true })
  await writeFile(baselinePath, serialized, "utf8")
  process.stdout.write(`Updated NeoView inventory baseline: ${baselinePath}\n`)
} else {
  const expected = await readFile(baselinePath, "utf8")
  if (expected !== serialized) {
    throw new Error(
      "NeoView inventory drift detected. Review the generated REPORT.md and dispositions, then rerun this verifier with --update.",
    )
  }
  process.stdout.write(`NeoView inventory matches baseline: ${baselinePath}\n`)
}

function normalizeInventory(inventory: Inventory) {
  return {
    schemaVersion: 1,
    inventorySchemaVersion: inventory.schemaVersion,
    generator: inventory.generator,
    sourceRevision: inventory.sourceRevision,
    rustFiles: inventory.rustFiles,
    commandDeclarations: inventory.commands.length,
    uniqueCommandNames: new Set(inventory.commands.map((command) => command.name)).size,
    registeredDeclarations: inventory.commands.filter((command) =>
      inventory.registeredCommands.includes(command.name)).length,
    uniqueRegisteredNames: inventory.registeredCommands.length,
    summary: inventory.summary,
    registeredCommands: [...inventory.registeredCommands].sort(),
    unannotatedRegistrations: [...inventory.unannotatedRegistrations].sort(),
    commands: inventory.commands
      .map((command) => sanitizeCommand(command))
      .sort((left, right) =>
        left.name.localeCompare(right.name) ||
        left.location.file.localeCompare(right.location.file) ||
        left.location.line - right.location.line),
  }
}

function sanitizeCommand(command: Inventory["commands"][number]) {
  const {
    name,
    rustPath,
    parameters,
    returnType,
    tsReturnType,
    async,
    registered,
    stateTypes,
    usesAppHandle,
    events,
    calls,
    nativeReasons,
    disposition,
    classificationSource,
    location,
  } = command
  const evidenceHash = createHash("sha256")
    .update(JSON.stringify({ parameters, stateTypes, events, calls, nativeReasons }))
    .digest("hex")
  return {
    name,
    rustPath,
    parameters,
    returnType,
    tsReturnType,
    async,
    registered,
    stateTypes,
    usesAppHandle,
    events,
    nativeReasons,
    evidenceHash: `sha256:${evidenceHash}`,
    disposition,
    classificationSource,
    location,
  }
}

function validateInventory(inventory: Inventory, updating: boolean): void {
  if (inventory.schemaVersion !== 2) {
    throw new Error(`Expected migration inventory schema 2, received ${inventory.schemaVersion}`)
  }
  if (inventory.sourceRevision.vcs !== "git" || !inventory.sourceRevision.commit) {
    throw new Error("NeoView inventory must record a Git source commit")
  }
  if (updating && inventory.sourceRevision.dirty) {
    throw new Error(
      `Refusing to update from a dirty NeoView source (${inventory.sourceRevision.dirtyDiffHash ?? "missing diff hash"})`,
    )
  }
  if (inventory.unannotatedRegistrations.length) {
    throw new Error(`Unannotated Tauri registrations remain: ${inventory.unannotatedRegistrations.join(", ")}`)
  }
  if ((inventory.summary["manual-review"] ?? 0) !== 0) {
    throw new Error(`Manual-review commands remain: ${inventory.summary["manual-review"]}`)
  }
}

function value(flag: string): string | undefined {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}
