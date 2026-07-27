import { copyFile, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { performance } from "node:perf_hooks"

const workspaceRoot = resolve(import.meta.dirname, "..", "..", "..")
const platformId = `${process.platform}-${process.arch}`
const bindingPath = process.env.CZKAWKA_BENCHMARK_BINDING_PATH || join(workspaceRoot, "native", "artifacts", platformId, `xiranite-czkawka.${platformId}.node`)
const archivePath = process.env.CZKAWKA_BENCHMARK_ARCHIVE_PATH || join(workspaceRoot, "native", "prebuilt", platformId, `czkawka.${platformId}.zip`)
const repeats = positiveInteger(process.env.CZKAWKA_BENCHMARK_REPEATS, 3)
const fixtureRoot = await mkdtemp(join(tmpdir(), "xiranite-czkawka-benchmark-"))
if (process.platform === "win32") process.env.PATH = `${dirname(bindingPath)};${process.env.PATH ?? ""}`
const binding = createRequire(import.meta.url)(bindingPath)
const { getCzkawkaInfo, scanDuplicateFiles, scanMediaFiles } = binding

try {
  const fixtures = await createFixtures(fixtureRoot)
  const scenarios = [
    {
      id: "duplicate-files",
      inputFileCount: 320,
      run: () => scanDuplicateFiles({
        includedDirectories: [fixtures.duplicates],
        checkMethod: "hash",
        hashType: "blake3",
        recursive: true,
        threadCount: 1,
        useCache: false,
      }),
    },
    {
      id: "similar-images",
      inputFileCount: 2,
      run: () => scanMediaFiles({
        tool: "similar-images",
        includedDirectories: [fixtures.images],
        recursive: true,
        threadCount: 1,
        useCache: false,
      }),
    },
    {
      id: "similar-videos",
      inputFileCount: 2,
      run: () => scanMediaFiles({
        tool: "similar-videos",
        includedDirectories: [fixtures.videos],
        recursive: true,
        threadCount: 1,
        useCache: false,
      }),
    },
    {
      id: "duplicate-music",
      inputFileCount: 2,
      run: () => scanMediaFiles({
        tool: "duplicate-music",
        includedDirectories: [fixtures.music],
        musicCheckType: "tags",
        musicMinimumFragmentDuration: 0,
        recursive: true,
        threadCount: 1,
        useCache: false,
      }),
    },
    {
      id: "broken-files",
      inputFileCount: 1,
      run: () => scanMediaFiles({
        tool: "broken-files",
        includedDirectories: [fixtures.broken],
        brokenAudio: false,
        brokenArchive: false,
        brokenImage: true,
        brokenPdf: false,
        recursive: true,
        threadCount: 1,
        useCache: false,
      }),
    },
  ]

  const results = []
  for (const scenario of scenarios) results.push(await measureScenario(scenario, repeats))

  const [bindingArtifact, archive] = await Promise.all([stat(bindingPath), stat(archivePath)])
  console.log(JSON.stringify({
    schemaVersion: 1,
    sourceVersion: getCzkawkaInfo().sourceVersion,
    apiVersion: getCzkawkaInfo().apiVersion,
    repeats,
    artifactBytes: { binding: bindingArtifact.size, prebuiltArchive: archive.size },
    scenarios: results,
  }, null, 2))
} finally {
  await rm(fixtureRoot, { recursive: true, force: true })
}

async function createFixtures(root) {
  const duplicates = join(root, "duplicates")
  const images = join(root, "images")
  const videos = join(root, "videos")
  const music = join(root, "music")
  const broken = join(root, "broken")
  await Promise.all([duplicates, images, videos, music, broken].map((directory) => mkdir(directory, { recursive: true })))

  for (let offset = 0; offset < 160; offset += 20) {
    await Promise.all(Array.from({ length: 20 }, async (_, index) => {
      const value = `duplicate-${offset + index}:`.padEnd(1024, "x")
      await Promise.all([
        writeFile(join(duplicates, `left-${offset + index}.bin`), value),
        writeFile(join(duplicates, `right-${offset + index}.bin`), value),
      ])
    }))
  }

  const imageSource = new URL("../../../vendor/folia-major/assets/placeholder_cover.jpg", import.meta.url)
  await Promise.all([copyFile(imageSource, join(images, "left.jpg")), copyFile(imageSource, join(images, "right.jpg"))])

  const videoSource = join(videos, "source.mp4")
  await createMediaFixture(["-f", "lavfi", "-i", "testsrc=size=320x180:rate=30", "-t", "3", "-c:v", "libx264", "-pix_fmt", "yuv420p", videoSource], "video")
  await copyFile(videoSource, join(videos, "copy.mp4"))

  const musicSource = join(music, "source.mp3")
  await createMediaFixture(["-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=44100", "-t", "3", "-metadata", "title=Czkawka Benchmark", "-metadata", "artist=Xiranite", "-metadata", "album=Czkawka Benchmark", "-c:a", "libmp3lame", musicSource], "music")
  await copyFile(musicSource, join(music, "copy.mp3"))

  await writeFile(join(broken, "invalid.jpg"), "not a valid JPEG")
  return { duplicates, images, videos, music, broken }
}

async function createMediaFixture(argumentsList, label) {
  const process = Bun.spawn(["ffmpeg", "-y", ...argumentsList], { stdout: "pipe", stderr: "pipe" })
  if (await process.exited !== 0) throw new Error(`FFmpeg could not create the ${label} benchmark fixture: ${await new Response(process.stderr).text()}`)
}

async function measureScenario({ id, inputFileCount, run }, count) {
  const samples = []
  for (let index = 0; index < count; index += 1) {
    let peakRssBytes = process.memoryUsage().rss
    const sampler = setInterval(() => { peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss) }, 10)
    const started = performance.now()
    const cpuStarted = process.cpuUsage()
    try {
      const result = await run()
      const resultCount = countResultEntries(result)
      if (!result || typeof result !== "object") throw new Error(`${id} benchmark scan did not return a result object.`)
      const elapsedMs = round(performance.now() - started)
      const cpuUsage = process.cpuUsage(cpuStarted)
      samples.push({
        elapsedMs,
        cpuMs: round((cpuUsage.user + cpuUsage.system) / 1_000),
        peakRssBytes,
        resultCount,
        throughputFilesPerSecond: round(inputFileCount / (elapsedMs / 1_000)),
      })
    } finally {
      clearInterval(sampler)
    }
  }
  const ordered = [...samples].sort((left, right) => left.elapsedMs - right.elapsedMs)
  return {
    id,
    inputFileCount,
    medianElapsedMs: ordered[Math.floor(ordered.length / 2)].elapsedMs,
    medianCpuMs: ordered[Math.floor(ordered.length / 2)].cpuMs,
    medianThroughputFilesPerSecond: ordered[Math.floor(ordered.length / 2)].throughputFilesPerSecond,
    peakRssBytes: Math.max(...samples.map((sample) => sample.peakRssBytes)),
    resultCount: samples[0].resultCount,
    samples,
  }
}

function countResultEntries(result) {
  if (Array.isArray(result.entries)) return result.entries.length
  if (Array.isArray(result.groups)) return result.groups.reduce((total, group) => total + (Array.isArray(group.entries) ? group.entries.length : Array.isArray(group.files) ? group.files.length : 0), 0)
  return 0
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10)
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 10 ? parsed : fallback
}

function round(value) {
  return Math.round(value * 100) / 100
}
