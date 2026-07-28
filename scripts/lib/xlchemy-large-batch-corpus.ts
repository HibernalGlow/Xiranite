import { createHash } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import {
  access,
  appendFile,
  link,
  mkdir,
  opendir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises"
import { basename, dirname, extname, join, resolve } from "node:path"
import { finished } from "node:stream/promises"

export interface XlchemyCorpusEntry {
  index: number
  sourcePath: string
  corpusPath: string
  relationship: "hard-link"
  sizeBytes: number
  mtimeMs: number
  sha256: string
  format: string
  width: number
  height: number
}

export interface XlchemyCorpusManifest {
  schemaVersion: 2
  createdAt: string
  sourceRoot: string
  corpusRoot: string
  minimumDimensions: { shortSide: number; longSide: number }
  decoder: { name: "sharp/libvips"; sharpVersion: string; libvipsVersion: string }
  entries: XlchemyCorpusEntry[]
  summary: ReturnType<typeof summarizeCorpus>
}

export interface XlchemyCorpusBuildOptions {
  sourceRoot: string
  workspace: string
  count: number
  minimumShortSide: number
  minimumLongSide: number
}

const IMAGE_EXTENSIONS = new Set([
  ".avif", ".bmp", ".jfif", ".jif", ".jpe", ".jpeg", ".jpg", ".jxl", ".png", ".tif", ".tiff", ".webp",
])
const XLCHEMY_DISCOVERABLE_EXTENSIONS = new Set([...IMAGE_EXTENSIONS, ".apng", ".clip", ".gif", ".ico", ".jp2", ".psb", ".psd"])

export async function buildXlchemyCorpus(config: XlchemyCorpusBuildOptions): Promise<void> {
  const sharp = (await import("sharp")).default
  const sourceRoot = resolve(config.sourceRoot)
  const progressPath = join(config.workspace, "corpus-progress.ndjson")
  const manifestPath = xlchemyCorpusManifestPath(config.workspace)
  const entries = await loadCorpusProgress(progressPath)
  const corpusRoot = existingCorpusRoot(entries, join(config.workspace, `corpus-${config.count}`), config.workspace)
  await mkdir(corpusRoot, { recursive: true })
  const incompatibleProgress = entries.find((entry) => entry.relationship !== "hard-link" || Math.min(entry.width, entry.height) < config.minimumShortSide || Math.max(entry.width, entry.height) < config.minimumLongSide)
  if (incompatibleProgress) throw new Error(`Corpus progress entry ${incompatibleProgress.index} is incompatible with the requested dimension contract; use a new workspace.`)
  const selectedSources = new Set(entries.map((entry) => normalizePath(entry.sourcePath)))
  const rejected = new Map<string, number>()
  process.stdout.write(`[xlchemy-acceptance] corpus resume count: ${entries.length}/${config.count}\n`)

  for await (const candidate of walkImageFiles(sourceRoot, config.workspace)) {
    if (entries.length >= config.count) break
    if (selectedSources.has(normalizePath(candidate))) continue
    let metadata: import("sharp").Metadata
    try {
      metadata = await sharp(candidate, { failOn: "error", sequentialRead: true }).metadata()
    } catch {
      increment(rejected, "metadata-error")
      continue
    }
    const width = metadata.width ?? 0
    const height = metadata.height ?? 0
    if ((metadata.pages ?? 1) !== 1) {
      increment(rejected, "animated-or-multipage")
      continue
    }
    if (Math.min(width, height) < config.minimumShortSide || Math.max(width, height) < config.minimumLongSide) {
      increment(rejected, "below-minimum-dimensions")
      continue
    }
    try {
      const decoded = await sharp(candidate, { failOn: "error", sequentialRead: true }).raw().toBuffer({ resolveWithObject: true })
      if (decoded.info.width !== width || decoded.info.height !== height || decoded.data.byteLength === 0) throw new Error("Decoded dimensions differ from metadata.")
    } catch {
      increment(rejected, "full-decode-error")
      continue
    }

    const sourceStat = await stat(candidate)
    const extension = extname(candidate).toLowerCase() || ".img"
    const index = entries.length
    const corpusPath = join(corpusRoot, `${String(index + 1).padStart(8, "0")}${extension}`)
    try { await link(candidate, corpusPath) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      const [source, existing] = await Promise.all([stat(candidate), stat(corpusPath)])
      if (source.dev !== existing.dev || source.ino !== existing.ino) throw new Error(`Corpus resume collision at ${corpusPath}.`)
    }
    const entry: XlchemyCorpusEntry = {
      index,
      sourcePath: candidate,
      corpusPath,
      relationship: "hard-link",
      sizeBytes: sourceStat.size,
      mtimeMs: sourceStat.mtimeMs,
      sha256: await hashFile(candidate),
      format: metadata.format ?? extension.slice(1),
      width,
      height,
    }
    entries.push(entry)
    selectedSources.add(normalizePath(candidate))
    await appendFile(progressPath, `${JSON.stringify(entry)}\n`)
    if (entries.length === 1 || entries.length % 100 === 0) {
      process.stdout.write(`[xlchemy-acceptance] corpus accepted ${entries.length}/${config.count}: ${candidate}\n`)
    }
  }

  if (entries.length !== config.count) {
    throw new Error(`Only ${entries.length}/${config.count} qualifying images were found. Rejections: ${JSON.stringify(Object.fromEntries(rejected))}`)
  }
  const manifest: XlchemyCorpusManifest = {
    schemaVersion: 2,
    createdAt: new Date().toISOString(),
    sourceRoot,
    corpusRoot,
    minimumDimensions: { shortSide: config.minimumShortSide, longSide: config.minimumLongSide },
    decoder: { name: "sharp/libvips", sharpVersion: sharp.versions.sharp, libvipsVersion: sharp.versions.vips },
    entries,
    summary: summarizeCorpus(entries),
  }
  await writeJson(manifestPath, manifest)
  await writeJson(join(config.workspace, "corpus-build-summary.json"), {
    manifestPath,
    accepted: entries.length,
    rejected: Object.fromEntries(rejected),
    summary: manifest.summary,
  })
  process.stdout.write(`[xlchemy-acceptance] corpus manifest written: ${manifestPath}\n`)
}

export async function verifyXlchemyOutputs(entries: XlchemyCorpusEntry[], outputRoot: string) {
  const sharp = (await import("sharp")).default
  const errors: string[] = []
  const expectedOutputPaths = new Set(entries.map((entry) => normalizePath(join(outputRoot, `${basename(entry.corpusPath, extname(entry.corpusPath))}.avif`))))
  let verified = 0
  let totalOutputBytes = 0
  let totalDecodedBytes = 0
  for (const entry of entries) {
    const outputPath = join(outputRoot, `${basename(entry.corpusPath, extname(entry.corpusPath))}.avif`)
    try {
      const outputStat = await stat(outputPath)
      if (outputStat.size <= 0) throw new Error("zero-byte output")
      const decoded = await sharp(outputPath, { failOn: "error", sequentialRead: true }).raw().toBuffer({ resolveWithObject: true })
      if (decoded.info.width !== entry.width || decoded.info.height !== entry.height) {
        throw new Error(`dimension mismatch ${decoded.info.width}x${decoded.info.height} != ${entry.width}x${entry.height}`)
      }
      if (decoded.data.byteLength === 0) throw new Error("decoder returned no pixels")
      totalOutputBytes += outputStat.size
      totalDecodedBytes += decoded.data.byteLength
      verified += 1
    } catch (error) {
      if (errors.length < 200) errors.push(`${outputPath}: ${errorMessage(error)}`)
    }
    if ((verified + errors.length) % 100 === 0) process.stdout.write(`[xlchemy-acceptance] outputs decoded ${verified + errors.length}/${entries.length}\n`)
  }
  const actualOutputPaths: string[] = []
  const directory = await opendir(outputRoot)
  for await (const entry of directory) {
    const path = normalizePath(join(outputRoot, entry.name))
    if (entry.isFile()) actualOutputPaths.push(path)
    else if (errors.length < 200) errors.push(`${path}: unexpected output entry`)
  }
  for (const path of actualOutputPaths) if (!expectedOutputPaths.has(path) && errors.length < 200) errors.push(`${path}: unexpected output`)
  if (actualOutputPaths.length !== expectedOutputPaths.size && errors.length < 200) errors.push(`output count ${actualOutputPaths.length} != ${expectedOutputPaths.size}`)
  return { expected: entries.length, verified, errors, actualOutputCount: actualOutputPaths.length, totalOutputBytes, totalDecodedBytes }
}

export async function verifyXlchemySources(entries: XlchemyCorpusEntry[], phase: string) {
  const errors: string[] = []
  let verified = 0
  for (const entry of entries) {
    try {
      const sourceStat = await stat(entry.sourcePath)
      const corpusStat = await stat(entry.corpusPath)
      if (sourceStat.size !== entry.sizeBytes || corpusStat.size !== entry.sizeBytes) throw new Error("source size changed")
      if (sourceStat.dev !== corpusStat.dev || sourceStat.ino !== corpusStat.ino) throw new Error("corpus path is no longer a hard link to the source")
      if (Math.abs(sourceStat.mtimeMs - entry.mtimeMs) > 1 || Math.abs(corpusStat.mtimeMs - entry.mtimeMs) > 1) throw new Error("source mtime changed")
      const digest = await hashFile(entry.sourcePath)
      if (digest !== entry.sha256) throw new Error("source hash changed")
      verified += 1
    } catch (error) {
      if (errors.length < 200) errors.push(`${entry.sourcePath}: ${errorMessage(error)}`)
    }
    if ((verified + errors.length) % 100 === 0) process.stdout.write(`[xlchemy-acceptance] ${phase} sources verified ${verified + errors.length}/${entries.length}\n`)
  }
  return { phase, expected: entries.length, verified, errors }
}

export async function buildXlchemyPreparationDirectory(entries: XlchemyCorpusEntry[], target: string, count: number, artifactRoot: string): Promise<void> {
  await mkdir(target, { recursive: true })
  const progressPath = join(artifactRoot, "directory-build-progress.json")
  const progress = await readJson<{ completed?: unknown }>(progressPath).catch(() => ({ completed: undefined }))
  const completedCheckpoint = typeof progress.completed === "number" && Number.isInteger(progress.completed) && progress.completed >= 0
    ? progress.completed
    : 0
  let completed = Math.min(completedCheckpoint, count)
  for (; completed < count; completed += 1) {
    const source = entries[completed % entries.length]!
    const targetPath = join(target, `${String(completed + 1).padStart(8, "0")}${extname(source.corpusPath)}`)
    if (!await exists(targetPath)) await link(source.corpusPath, targetPath)
    if ((completed + 1) % 1_000 === 0) {
      await writeJson(progressPath, { completed: completed + 1, target, count })
      process.stdout.write(`[xlchemy-acceptance] preparation directory ${completed + 1}/${count}\n`)
    }
  }
  await writeJson(progressPath, { completed: count, target, count })
  let actualCount = 0
  const directory = await opendir(target)
  for await (const entry of directory) {
    if (entry.isFile() && XLCHEMY_DISCOVERABLE_EXTENSIONS.has(extname(entry.name).toLowerCase())) actualCount += 1
    else if (entry.isDirectory()) throw new Error(`Preparation directory contains unexpected subdirectory ${entry.name}. Use a new workspace.`)
  }
  if (actualCount !== count) throw new Error(`Preparation directory contains ${actualCount} image file(s); expected ${count}. Use a new workspace.`)
}

export async function buildXlchemyPreparationEfu(entries: XlchemyCorpusEntry[], target: string, count: number): Promise<void> {
  if (await exists(target)) {
    const lines = await countFileLines(target)
    if (lines === count + 1) return
    throw new Error(`Preparation EFU contains ${lines} line(s); expected ${count + 1}. Use a new workspace.`)
  }
  const output = createWriteStream(target, { encoding: "utf8" })
  await writeStreamLine(output, "Filename,Size")
  for (let index = 0; index < count; index += 1) {
    const entry = entries[index % entries.length]!
    await writeStreamLine(output, `${csv(entry.corpusPath)},${entry.sizeBytes}`)
    if ((index + 1) % 10_000 === 0) process.stdout.write(`[xlchemy-acceptance] EFU records ${index + 1}/${count}\n`)
  }
  output.end()
  await finished(output)
}

export async function loadXlchemyCorpusManifest(workspace: string, expectedCount: number, minimumShortSide: number, minimumLongSide: number): Promise<XlchemyCorpusManifest> {
  const manifest = await readJson<XlchemyCorpusManifest>(xlchemyCorpusManifestPath(workspace))
  if (manifest.schemaVersion !== 2 || manifest.entries.length !== expectedCount) {
    throw new Error(`Corpus manifest has ${manifest.entries.length} entries; expected ${expectedCount}.`)
  }
  if (!manifest.decoder?.sharpVersion || !manifest.decoder.libvipsVersion) throw new Error("Corpus manifest is missing independent decoder versions.")
  const invalid = manifest.entries.find((entry) => entry.relationship !== "hard-link" || Math.min(entry.width, entry.height) < minimumShortSide || Math.max(entry.width, entry.height) < minimumLongSide)
  if (invalid) throw new Error(`Corpus entry ${invalid.index} does not satisfy the hard-link and ${minimumLongSide}x${minimumShortSide} dimension contract.`)
  const sourcePaths = new Set(manifest.entries.map((entry) => normalizePath(entry.sourcePath)))
  const expectedPaths = new Set(manifest.entries.map((entry) => normalizePath(entry.corpusPath)))
  if (sourcePaths.size !== manifest.entries.length || expectedPaths.size !== manifest.entries.length) throw new Error("Corpus manifest contains duplicate source or corpus paths.")
  if (manifest.entries.some((entry, index) => entry.index !== index)) throw new Error("Corpus manifest indices are not contiguous and zero-based.")
  const recomputedSummary = summarizeCorpus(manifest.entries)
  if (JSON.stringify(manifest.summary) !== JSON.stringify(recomputedSummary)) throw new Error("Corpus manifest summary does not match its entries.")
  const actualPaths: string[] = []
  const directory = await opendir(manifest.corpusRoot)
  for await (const entry of directory) {
    const path = normalizePath(join(manifest.corpusRoot, entry.name))
    if (!entry.isFile() || !expectedPaths.has(path)) throw new Error(`Corpus directory contains unexpected entry ${path}.`)
    actualPaths.push(path)
  }
  if (actualPaths.length !== expectedPaths.size || actualPaths.some((path) => !expectedPaths.has(path))) {
    throw new Error(`Corpus directory contains ${actualPaths.length} image file(s), but the manifest describes ${expectedPaths.size}.`)
  }
  return manifest
}

function xlchemyCorpusManifestPath(workspace: string): string {
  return join(workspace, "corpus-manifest.json")
}

function existingCorpusRoot(entries: XlchemyCorpusEntry[], requestedRoot: string, workspace: string): string {
  if (!entries.length) return requestedRoot
  const root = resolve(dirname(entries[0]!.corpusPath))
  const normalizedRoot = normalizePath(root)
  const normalizedWorkspace = normalizePath(workspace)
  if (normalizedRoot !== normalizedWorkspace && !normalizedRoot.startsWith(`${normalizedWorkspace}/`)) {
    throw new Error(`Corpus progress points outside the workspace: ${root}`)
  }
  if (entries.some((entry) => normalizePath(dirname(entry.corpusPath)) !== normalizedRoot)) {
    throw new Error("Corpus progress points to more than one corpus directory.")
  }
  return root
}

function summarizeCorpus(entries: XlchemyCorpusEntry[]) {
  const sizes = entries.map((entry) => entry.sizeBytes).sort((left, right) => left - right)
  const shortSides = entries.map((entry) => Math.min(entry.width, entry.height)).sort((left, right) => left - right)
  const longSides = entries.map((entry) => Math.max(entry.width, entry.height)).sort((left, right) => left - right)
  return {
    count: entries.length,
    totalBytes: sizes.reduce((sum, value) => sum + value, 0),
    formats: Object.fromEntries(countValues(entries.map((entry) => entry.format))),
    sizeBytes: distribution(sizes),
    shortSide: distribution(shortSides),
    longSide: distribution(longSides),
  }
}

async function* walkImageFiles(root: string, excludedRoot: string): AsyncGenerator<string> {
  const normalizedExcluded = normalizePath(resolve(excludedRoot))
  const directories = [root]
  while (directories.length) {
    const directory = directories.pop()!
    const handle = await opendir(directory)
    for await (const entry of handle) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (!normalizePath(resolve(path)).startsWith(`${normalizedExcluded}/`) && normalizePath(resolve(path)) !== normalizedExcluded) directories.push(path)
      } else if (entry.isFile() && IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        yield path
      }
    }
  }
}

async function loadCorpusProgress(path: string): Promise<XlchemyCorpusEntry[]> {
  const text = await readFile(path, "utf8").catch(() => "")
  return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as XlchemyCorpusEntry)
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest("hex")
}

async function countFileLines(path: string): Promise<number> {
  let lines = 0
  for await (const chunk of createReadStream(path)) for (const byte of chunk as Buffer) if (byte === 10) lines += 1
  return lines
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T
}

async function writeStreamLine(stream: ReturnType<typeof createWriteStream>, value: string): Promise<void> {
  if (!stream.write(`${value}\n`)) await new Promise<void>((resolveDrain) => stream.once("drain", resolveDrain))
}

function distribution(sorted: number[]) {
  return {
    min: sorted[0] ?? 0,
    median: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted.at(-1) ?? 0,
  }
}

function percentile(sorted: number[], fraction: number): number {
  if (!sorted.length) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))]!
}

function normalizePath(path: string): string {
  return resolve(path).replace(/\\/g, "/").toLocaleLowerCase("en-US")
}

function countValues(values: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return new Map([...counts].sort((left, right) => right[1] - left[1]))
}

function increment(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1)
}

function csv(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function exists(path: string): Promise<boolean> {
  return await access(path).then(() => true).catch(() => false)
}
