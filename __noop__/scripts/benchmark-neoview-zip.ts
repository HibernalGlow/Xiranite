import { performance } from "node:perf_hooks"
import { createHash } from "node:crypto"

import { ZipArchiveProvider } from "../packages/nodes/neoview/src/platform/archives/zip/ZipArchiveProvider.js"
import { createZipFixture, deterministicBytes } from "../packages/nodes/neoview/test/fixture-builders/create-zip-fixture.js"

const mib = 1024 * 1024
const storedBytes = deterministicBytes(32 * mib)
const deflatedBytes = repeatingBytes(16 * mib)
const fixture = await createZipFixture({
  name: "benchmark.cbz",
  entries: [
    { path: "pages/stored.bin", bytes: storedBytes, level: 0 },
    { path: "pages/deflated.bin", bytes: deflatedBytes, level: 6 },
  ],
})

let fileBytesRead = 0
let readCalls = 0
let maxRead = 0
const provider = new ZipArchiveProvider(fixture.path, {
  onRead: (_offset, length, actual) => {
    fileBytesRead += actual
    readCalls += 1
    maxRead = Math.max(maxRead, length)
  },
})

try {
  const indexStart = performance.now()
  const entries = await provider.list()
  const indexMs = performance.now() - indexStart
  const indexBytesRead = fileBytesRead
  const indexReadCalls = readCalls
  const measurements = []

  for (const entry of entries) {
    fileBytesRead = 0
    readCalls = 0
    const stream = await provider.openEntry(entry.id)
    const reader = stream.getReader()
    const firstStart = performance.now()
    const first = await reader.read()
    const firstChunkMs = performance.now() - firstStart
    const fullStart = performance.now()
    let outputBytes = first.value?.byteLength ?? 0
    while (!first.done) {
      const result = await reader.read()
      if (result.done) break
      outputBytes += result.value.byteLength
    }
    const remainingMs = performance.now() - fullStart
    const totalMs = firstChunkMs + remainingMs
    measurements.push({
      path: entry.path,
      compression: entry.compressionMethod,
      outputMiB: round(outputBytes / mib),
      firstChunkKiB: round((first.value?.byteLength ?? 0) / 1024),
      firstChunkMs: round(firstChunkMs),
      totalMs: round(totalMs),
      throughputMiBPerSecond: round(outputBytes / mib / (totalMs / 1000)),
      sourceMiBRead: round(fileBytesRead / mib),
      sourceReadCalls: readCalls,
    })
  }

  process.stdout.write(`${JSON.stringify({
    runtime: `Bun ${Bun.version}`,
    platform: `${process.platform}-${process.arch}`,
    cacheState: "new provider; operating-system file cache unspecified",
    storage: "temporary filesystem; disk type not detected",
    sampleSha256: createHash("sha256").update(storedBytes).update(deflatedBytes).digest("hex"),
    archiveSha256: createHash("sha256").update(fixture.bytes).digest("hex"),
    payloadMiB: round((storedBytes.byteLength + deflatedBytes.byteLength) / mib),
    archiveMiB: round(fixture.bytes.byteLength / mib),
    index: {
      milliseconds: round(indexMs),
      sourceKiBRead: round(indexBytesRead / 1024),
      sourceReadCalls: indexReadCalls,
      maxReadKiB: round(maxRead / 1024),
    },
    entries: measurements,
  }, null, 2)}\n`)
} finally {
  await provider.close()
  await fixture.cleanup()
}

function repeatingBytes(length: number): Uint8Array {
  const output = new Uint8Array(length)
  const pattern = new TextEncoder().encode("NeoView-comic-page-benchmark-pattern-0123456789\n")
  for (let offset = 0; offset < output.length; offset += pattern.length) {
    output.set(pattern.subarray(0, Math.min(pattern.length, output.length - offset)), offset)
  }
  return output
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
