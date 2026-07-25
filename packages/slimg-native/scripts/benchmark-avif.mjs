import { existsSync } from "node:fs"
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises"
import { availableParallelism, tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"
import { performance } from "node:perf_hooks"

import { convertBatch } from "../dist/index.js"

const inputPaths = process.argv.slice(2).filter((argument) => !argument.startsWith("--")).map((argument) => resolve(argument))
const requestedModes = value("modes", "node,aom,cffi").split(",").map((mode) => mode.trim()).filter(Boolean)
const quality = integer("quality", 60)
const effort = integer("effort", 6)
const jobs = integer("jobs", 15)
const repeat = integer("repeat", 1)
const cffiPath = value("cffi", process.env.SLIMG_CFFI_PATH ?? "C:\\Windows\\System32\\slimg_cffi.dll")

if (!inputPaths.length || inputPaths.some((path) => !existsSync(path))) {
  throw new Error("Usage: benchmark-avif.mjs <image> [image...] [--modes=node,aom,cffi] [--quality=60] [--effort=6] [--jobs=15] [--repeat=1]")
}

const directory = await mkdtemp(join(tmpdir(), "xiranite-slimg-benchmark-"))
try {
  const results = []
  for (const mode of requestedModes) {
    const result = await benchmarkMode(mode)
    if (result) results.push(result)
  }
  console.table(results.map(({ mode, elapsedMs, outputBytes, files, cpuCores, processCpuCapacityPercent }) => ({
    mode,
    files,
    elapsedMs: elapsedMs.toFixed(1),
    throughputFilesPerSecond: (files / (elapsedMs / 1000)).toFixed(2),
    averageSecondsPerFile: (elapsedMs / 1000 / files).toFixed(2),
    averageCpuCores: mode === "aom-avifenc" ? "child" : cpuCores.toFixed(2),
    processCpuCapacityPercent: mode === "aom-avifenc" ? "child" : processCpuCapacityPercent.toFixed(1),
    outputMiB: (outputBytes / 1024 / 1024).toFixed(2),
  })))
  console.log(JSON.stringify({ quality, effort, jobs, repeat, inputs: inputPaths, results }, null, 2))
} finally {
  await rm(directory, { recursive: true, force: true })
}

async function benchmarkMode(mode) {
  if (mode === "node") return benchmarkNode()
  if (mode === "aom") return benchmarkAom()
  if (mode === "cffi") return benchmarkCffi()
  throw new Error(`Unknown benchmark mode: ${mode}`)
}

async function benchmarkNode() {
  await mkdir(join(directory, "node"), { recursive: true })
  const files = repeatedFiles("node")
  const cpuStarted = process.cpuUsage()
  const started = performance.now()
  const result = await convertBatch({ files, format: "avif", quality, jobs, overwrite: true, batchId: `benchmark-node-${process.pid}` })
  const elapsedMs = performance.now() - started
  if (result.failed || result.cancelled) throw new Error(`Node-API benchmark failed: ${JSON.stringify(result)}`)
  return withCpu({ mode: "node-api", elapsedMs, outputBytes: result.files.reduce((sum, file) => sum + file.outputSize, 0), files: files.length }, process.cpuUsage(cpuStarted))
}

async function benchmarkAom() {
  const avifenc = Bun.which("avifenc")
  if (!avifenc) return unavailable("aom", "avifenc is not on PATH")
  await mkdir(join(directory, "aom"), { recursive: true })
  const files = repeatedFiles("aom")
  const started = performance.now()
  for (const file of files) {
    const processResult = Bun.spawnSync([avifenc, "-q", String(quality), "-s", String(effort), "-j", String(jobs), "-c", "aom", file.sourcePath, file.outputPath], { stdout: "ignore", stderr: "pipe" })
    if (!processResult.success) throw new Error(`avifenc failed: ${processResult.stderr.toString()}`)
  }
  return resultFromFiles("aom-avifenc", performance.now() - started, files)
}

async function benchmarkCffi() {
  if (!existsSync(cffiPath)) return unavailable("cffi", `binding not found: ${cffiPath}`)
  await mkdir(join(directory, "cffi"), { recursive: true })
  const { dlopen, ptr, read, toArrayBuffer } = await import("bun:ffi")
  const library = dlopen(cffiPath, {
    slimg_decode_file: { args: ["ptr"], returns: "ptr" },
    slimg_convert: { args: ["ptr", "u64", "u32", "u32", "i32", "u8"], returns: "ptr" },
    slimg_free_buffer_ptr: { args: ["ptr"], returns: "void" },
  })
  const files = repeatedFiles("cffi")
  const cpuStarted = process.cpuUsage()
  const started = performance.now()
  try {
    for (const file of files) {
      let decodedPointer = null
      let convertedPointer = null
      try {
        decodedPointer = library.symbols.slimg_decode_file(ptr(Buffer.from(`${file.sourcePath}\0`, "utf8")))
        if (!decodedPointer) throw new Error(`CFFI decode failed: ${file.sourcePath}`)
        const decoded = copyBuffer(decodedPointer, read, toArrayBuffer)
        library.symbols.slimg_free_buffer_ptr(decodedPointer)
        decodedPointer = null
        convertedPointer = library.symbols.slimg_convert(ptr(decoded.data), BigInt(decoded.data.byteLength), decoded.width, decoded.height, 3, quality)
        if (!convertedPointer) throw new Error(`CFFI encode failed: ${file.sourcePath}`)
        const encoded = copyBuffer(convertedPointer, read, toArrayBuffer)
        await Bun.write(file.outputPath, encoded.data)
      } finally {
        if (convertedPointer) library.symbols.slimg_free_buffer_ptr(convertedPointer)
        if (decodedPointer) library.symbols.slimg_free_buffer_ptr(decodedPointer)
      }
    }
  } finally {
    library.close()
  }
  return withCpu(await resultFromFiles("legacy-cffi", performance.now() - started, files), process.cpuUsage(cpuStarted))
}

function repeatedFiles(mode) {
  return Array.from({ length: repeat }, (_, cycle) => inputPaths.map((sourcePath, index) => ({
    sourcePath,
    outputPath: join(directory, mode, `${cycle}-${index}-${basename(sourcePath)}.avif`),
  }))).flat()
}

async function resultFromFiles(mode, elapsedMs, files) {
  let outputBytes = 0
  for (const file of files) outputBytes += (await stat(file.outputPath)).size
  return { mode, elapsedMs, outputBytes, files: files.length }
}

function withCpu(result, usage) {
  const cpuMs = (usage.user + usage.system) / 1000
  const cpuCores = cpuMs / result.elapsedMs
  return { ...result, cpuMs, cpuCores, processCpuCapacityPercent: cpuCores / availableParallelism() * 100 }
}

function copyBuffer(bufferPointer, read, toArrayBuffer) {
  const dataPointer = read.ptr(bufferPointer, 0)
  const length = Number(read.u64(bufferPointer, 8))
  if (!dataPointer || !Number.isSafeInteger(length) || length <= 0) throw new Error("slimg returned an invalid image buffer")
  return { data: new Uint8Array(toArrayBuffer(dataPointer, 0, length)).slice(), width: read.u32(bufferPointer, 16), height: read.u32(bufferPointer, 20) }
}

function unavailable(mode, reason) {
  console.warn(`${mode} benchmark skipped: ${reason}`)
  return undefined
}

function value(name, fallback) {
  const prefix = `--${name}=`
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? fallback
}

function integer(name, fallback) {
  const parsed = Number.parseInt(value(name, String(fallback)), 10)
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`--${name} must be a positive integer`)
  return parsed
}
