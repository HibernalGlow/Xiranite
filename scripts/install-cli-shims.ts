#!/usr/bin/env bun
import { access, mkdir, readFile, writeFile } from "node:fs/promises"
import { delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { homedir, platform } from "node:os"
import { NODE_CLI_REGISTRY } from "../packages/cli/src/index.ts"

interface Options {
  dryRun: boolean
  force: boolean
  legacyAliases: boolean
  posix: boolean
  target: string
}

interface ShimSpec {
  name: string
  target: string
  args?: string[]
  legacy?: boolean
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const defaultTarget = join(homedir(), ".xiranite", "bin")
const managedMarker = "xiranite-shim: managed"

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const targetDir = resolveHome(options.target)
  const shims = createShimSpecs(options)

  await assertBuildOutputs(shims)

  if (!options.dryRun) {
    await mkdir(targetDir, { recursive: true })
  }

  const summary = { write: 0, overwrite: 0, skip: 0 }
  for (const shim of shims) {
    for (const file of createShimFiles(shim, options)) {
      const result = await installShim(targetDir, file.name, file.content, options)
      summary[result] += 1
      console.log(`${formatAction(result, options)} ${join(targetDir, file.name)}`)
    }
  }

  console.log("")
  console.log(`Target: ${targetDir}`)
  console.log(`Summary: ${summary.write} write, ${summary.overwrite} overwrite, ${summary.skip} skip`)
  printPathGuidance(targetDir, options)
}

function parseArgs(args: string[]): Options {
  const options: Options = {
    dryRun: false,
    force: false,
    legacyAliases: false,
    posix: platform() !== "win32",
    target: defaultTarget,
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--help" || arg === "-h") {
      printHelp()
      process.exit(0)
    }
    if (arg === "--dry-run") options.dryRun = true
    else if (arg === "--force") options.force = true
    else if (arg === "--legacy-aliases") options.legacyAliases = true
    else if (arg === "--posix") options.posix = true
    else if (arg === "--no-posix") options.posix = false
    else if (arg === "--target") options.target = requireValue(args, ++index, "--target")
    else if (arg.startsWith("--target=")) options.target = arg.slice("--target=".length)
    else throw new Error(`Unknown option: ${arg}`)
  }

  return options
}

function createShimSpecs(options: Options): ShimSpec[] {
  const aggregate = join(repoRoot, "packages", "cli", "dist", "index.js")
  const shims: ShimSpec[] = [
    { name: "xiranite", target: aggregate },
    ...NODE_CLI_REGISTRY.map((node) => ({
      name: node.bin,
      target: join(repoRoot, "packages", "nodes", node.id, "dist", "cli.js"),
    })),
  ]

  if (options.legacyAliases) {
    shims.push(
      { name: "anode", target: aggregate, legacy: true },
      { name: "aestiv", target: aggregate, legacy: true },
      { name: "aestiva", target: aggregate, legacy: true },
    )
  }

  return shims
}

async function assertBuildOutputs(shims: ShimSpec[]): Promise<void> {
  const missing: string[] = []
  for (const shim of shims) {
    try {
      await access(shim.target)
    } catch {
      missing.push(shim.target)
    }
  }

  if (missing.length) {
    throw new Error([
      "CLI dist files are missing. Run `bun run build:packages` first.",
      ...missing.map((path) => `- ${path}`),
    ].join("\n"))
  }
}

function createShimFiles(shim: ShimSpec, options: Options): Array<{ name: string; content: string }> {
  const files = [{ name: `${shim.name}.cmd`, content: renderCmdShim(shim) }]
  if (options.posix) {
    files.push({ name: shim.name, content: renderPosixShim(shim) })
  }
  return files
}

async function installShim(
  targetDir: string,
  fileName: string,
  content: string,
  options: Pick<Options, "dryRun" | "force">,
): Promise<"write" | "overwrite" | "skip"> {
  const target = join(targetDir, fileName)
  const existing = await readExisting(target)
  const exists = existing !== null
  const managed = existing?.includes(managedMarker) ?? false

  if (exists && !managed && !options.force) {
    return "skip"
  }

  const action = exists ? "overwrite" : "write"
  if (!options.dryRun) {
    await writeFile(target, content, { encoding: "utf8", mode: 0o755 })
  }
  return action
}

async function readExisting(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8")
  } catch {
    return null
  }
}

function renderCmdShim(shim: ShimSpec): string {
  const args = shim.args?.join(" ") ?? ""
  return [
    "@echo off",
    `REM ${managedMarker}`,
    `REM command: ${shim.name}`,
    `REM target: ${shim.target}`,
    shim.legacy ? "REM legacy-alias: true" : "REM legacy-alias: false",
    `bun "${shim.target}"${args ? ` ${args}` : ""} %*`,
    "",
  ].join("\r\n")
}

function renderPosixShim(shim: ShimSpec): string {
  const args = shim.args?.map(shellQuote).join(" ") ?? ""
  return [
    "#!/usr/bin/env sh",
    `# ${managedMarker}`,
    `# command: ${shim.name}`,
    `# target: ${shim.target}`,
    shim.legacy ? "# legacy-alias: true" : "# legacy-alias: false",
    `exec bun ${shellQuote(shim.target)}${args ? ` ${args}` : ""} "$@"`,
    "",
  ].join("\n")
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

function resolveHome(value: string): string {
  if (value === "~") return homedir()
  if (value.startsWith("~/") || value.startsWith("~\\")) return join(homedir(), value.slice(2))
  return resolve(value)
}

function requireValue(args: string[], index: number, option: string): string {
  const value = args[index]
  if (!value) throw new Error(`${option} requires a value.`)
  return value
}

function formatAction(action: "write" | "overwrite" | "skip", options: Pick<Options, "dryRun">): string {
  if (options.dryRun && action !== "skip") return `would-${action.padEnd(9)}`
  return action.padEnd(15)
}

function printPathGuidance(targetDir: string, options: Options): void {
  const pathParts = (process.env.PATH ?? "").split(delimiter).map((value) => resolve(value)).filter(Boolean)
  const inPath = pathParts.some((entry) => samePath(entry, targetDir))

  if (inPath) {
    console.log("PATH: target is already present. Put it before Python Scripts if legacy commands still win.")
  } else {
    console.log("PATH: target is not currently present.")
    if (platform() === "win32") {
      console.log(`PowerShell current session: $env:Path = "${targetDir};$env:Path"`)
      console.log("Persist it from Windows Environment Variables, placing this target before Python Scripts.")
    } else {
      console.log(`Current shell session: export PATH="${targetDir}:$PATH"`)
      console.log("Persist it in your shell profile before older Python command directories.")
    }
  }

  if (!options.legacyAliases) {
    console.log("Legacy aliases not installed. Add `--legacy-aliases` to create anode/aestiv/aestiva shims.")
  }
}

function samePath(left: string, right: string): boolean {
  return resolve(left).toLowerCase() === resolve(right).toLowerCase()
}

function printHelp(): void {
  console.log([
    "Usage: bun scripts/install-cli-shims.ts [options]",
    "",
    "Options:",
    "  --target <dir>       Shim directory. Default: ~/.xiranite/bin",
    "  --dry-run            Print actions without writing files",
    "  --force              Overwrite unmanaged files in the target directory",
    "  --legacy-aliases     Also create anode/aestiv/aestiva aliases to xiranite",
    "  --posix              Also write POSIX shell shims",
    "  --no-posix           Write only Windows .cmd shims",
    "  -h, --help           Show this help",
  ].join("\n"))
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
