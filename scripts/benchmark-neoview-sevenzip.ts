import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { performance } from "node:perf_hooks"
import { promisify } from "node:util"

import type { ResourceScheduler, ResourceTaskRequest } from "../packages/nodes/neoview/src/ports/ResourceScheduler.js"
import { SevenZipArchiveProvider } from "../packages/nodes/neoview/src/platform/archives/sevenzip/SevenZipArchiveProvider.js"
import { resolveSevenZipExecutable } from "../packages/nodes/neoview/src/platform/archives/sevenzip/SevenZipExecutable.js"
import { deterministicBytes } from "../packages/nodes/neoview/test/fixture-builders/create-zip-fixture.js"

const execFileAsync = promisify(execFile)
const mib = 1024 * 1024
const pageBytes = 16 * mib
const pageCount = 3
const executable = await resolveSevenZipExecutable()
const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-sevenzip-benchmark-"))
const sourceDirectory = join(root, "pages")
const materializedDirectory = join(root, "materialized")
const archivePath = join(root, "benchmark-solid.cb7")

try {
  await Promise.all([mkdir(sourceDirectory), mkdir(materializedDirectory)])
  const sampleHash = createHash("sha256")
  for (let page = 0; page < pageCount; page += 1) {
    const bytes = deterministicBytes(pageBytes)
    bytes[0] = page + 1
    sampleHash.update(bytes)
    await writeFile(join(sourceDirectory, `${String(page + 1).padStart(3, "0")}.jpg`), bytes)
  }
  await execFileAsync(executable.path, [
    "a", "-t7z", "-mx=1", "-ms=on", "-mtc=off", "-mta=off", "-mtm=off", "-bd", "-bb0", "--", archivePath, "pages",
  ], { cwd: root, windowsHide: true, maxBuffer: 4 * mib })

  const sequential = await measureProvider(archivePath, materializedDirectory, "first-then-adjacent")
  const directLast = await measureProvider(archivePath, materializedDirectory, "last-page-first")
  const archiveBytes = await readFile(archivePath)
  process.stdout.write(`${JSON.stringify({
    benchmarkIds: ["archive-entry-ttfb", "solid-adjacent-page"],
    runtime: `Bun ${Bun.version}`,
    platform: `${process.platform}-${process.arch}`,
    sevenZip: executable,
    cacheState: "new provider per scenario; operating-system file cache unspecified",
    storage: "temporary filesystem; disk type not detected",
    sampleSha256: sampleHash.digest("hex"),
    archiveSha256: createHash("sha256").update(archiveBytes).digest("hex"),
    payloadMiB: pageCount * pageBytes / mib,
    archiveMiB: round(archiveBytes.byteLength / mib),
    sequential,
    directLast,
  }, null, 2)}\n`)
} finally {
  await rm(root, { recursive: true, force: true })
}

async function measureProvider(
  sourcePath: string,
  solidTempDirectory: string,
  scenario: "first-then-adjacent" | "last-page-first",
): Promise<unknown> {
  const scheduler = new CountingScheduler()
  const provider = new SevenZipArchiveProvider(sourcePath, {
    executable,
    resourceScheduler: scheduler,
    solidTempDirectory,
  })
  let result: unknown
  try {
    const indexStart = performance.now()
    const entries = (await provider.list()).filter((entry) => entry.kind === "file")
    const indexMs = performance.now() - indexStart
    const targets = scenario === "first-then-adjacent" ? entries.slice(0, 2) : entries.slice(-1)
    const measurements = []
    for (const entry of targets) {
      const openStart = performance.now()
      const stream = await provider.openEntry(entry!.id)
      const entryReadyMs = performance.now() - openStart
      const reader = stream.getReader()
      const firstStart = performance.now()
      const first = await reader.read()
      const firstChunkMs = performance.now() - firstStart
      let bytes = first.value?.byteLength ?? 0
      for (;;) {
        const result = await reader.read()
        if (result.done) break
        bytes += result.value.byteLength
      }
      measurements.push({
        path: entry!.path,
        entryReadyMs: round(entryReadyMs),
        firstChunkMs: round(firstChunkMs),
        outputMiB: round(bytes / mib),
      })
    }
    result = {
      indexMs: round(indexMs),
      entries: measurements,
      schedulerRequests: scheduler.requests,
      solidExtractorLeases: scheduler.requests.filter((request) => request.kind === "neoview.archive-solid-extract").length,
    }
  } finally {
    await provider.close()
  }
  const leftovers = await readdir(solidTempDirectory)
  if (leftovers.length) throw new Error(`Solid benchmark leaked temporary directories: ${leftovers.join(", ")}`)
  return result
}

class CountingScheduler implements ResourceScheduler {
  readonly requests: ResourceTaskRequest[] = []

  async acquire(request: ResourceTaskRequest, signal?: AbortSignal): Promise<{ release(): void }> {
    signal?.throwIfAborted()
    this.requests.push({ ...request })
    return { release() {} }
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
