import { mkdir, stat, writeFile } from "node:fs/promises"
import { basename, extname, join } from "node:path"

import { createNodeXlchemyRuntime } from "../packages/nodes/xlchemy/src/platform.js"
import { convertWithSlimg, probeSlimg } from "../packages/nodes/xlchemy/src/slimg.js"

interface ImageIdentity {
  format: string
  width: number
  height: number
}

const argumentsList = process.argv.slice(2)
const outputArgument = argumentsList.indexOf("--output")
if (outputArgument < 0 || !argumentsList[outputArgument + 1]) throw new Error("Usage: bun scripts/qa-xlchemy-slimg-inputs.ts --output <directory> <input>...")
const outputRoot = argumentsList[outputArgument + 1]!
argumentsList.splice(outputArgument, 2)
if (!argumentsList.length) throw new Error("At least one real input image is required.")

const runtime = createNodeXlchemyRuntime()
const magick = await required("magick")
const avifdec = await required("avifdec")
const slimg = await probeSlimg()
if (!slimg.runnable) throw new Error(slimg.detail || "SlimG DLL is unavailable.")
await mkdir(outputRoot, { recursive: true })

const records: Array<Record<string, unknown>> = []
for (const [index, source] of argumentsList.entries()) {
  const sourceIdentity = await identify(source)
  const label = `${String(index + 1).padStart(2, "0")}-${sourceIdentity.format.toLowerCase()}-${sanitize(basename(source, extname(source)))}`
  const output = join(outputRoot, `${label}.avif`)
  const decoded = join(outputRoot, `${label}-decoded.png`)
  const startedAt = performance.now()
  await convertWithSlimg(source, output, 60)
  const elapsedMs = performance.now() - startedAt
  await command(avifdec, [output, decoded])
  const decodedIdentity = await identify(decoded)
  if (decodedIdentity.width !== sourceIdentity.width || decodedIdentity.height !== sourceIdentity.height) {
    throw new Error(`${source}: decoded dimensions ${decodedIdentity.width}x${decodedIdentity.height} do not match ${sourceIdentity.width}x${sourceIdentity.height}.`)
  }
  const [sourceStat, outputStat] = await Promise.all([stat(source), stat(output)])
  records.push({
    source,
    sourceFormat: sourceIdentity.format,
    width: sourceIdentity.width,
    height: sourceIdentity.height,
    sourceBytes: sourceStat.size,
    output,
    outputBytes: outputStat.size,
    decoded,
    elapsedMs: rounded(elapsedMs),
  })
  process.stdout.write(`[xlchemy-slimg-qa] ${index + 1}/${argumentsList.length} ${sourceIdentity.format} ${sourceIdentity.width}x${sourceIdentity.height}\n`)
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  bunVersion: Bun.version,
  slimg,
  expected: argumentsList.length,
  verified: records.length,
  records,
}
const reportPath = join(outputRoot, "slimg-input-compatibility.json")
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
process.stdout.write(`${JSON.stringify({ reportPath, expected: argumentsList.length, verified: records.length }, null, 2)}\n`)

async function identify(path: string): Promise<ImageIdentity> {
  const result = await runtime.runCommand(magick, ["identify", "-ping", "-format", "%m\t%w\t%h", `${path}[0]`])
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || `ImageMagick could not identify ${path}.`)
  const [format, widthText, heightText] = result.stdout.trim().split("\t")
  const width = Number(widthText)
  const height = Number(heightText)
  if (!format || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new Error(`Invalid image identity for ${path}: ${result.stdout}`)
  return { format, width, height }
}

async function required(name: string): Promise<string> {
  const resolved = await runtime.resolveCommand([name])
  if (!resolved) throw new Error(`Missing required command: ${name}`)
  return resolved
}

async function command(executable: string, args: string[]): Promise<void> {
  const result = await runtime.runCommand(executable, args)
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || `${executable} failed.`)
}

function sanitize(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "input"
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100
}
