#!/usr/bin/env bun
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

interface ChunkReport {
  fileName: string
  bytes: number
  modules: string[]
}

const reportPath = resolve("artifacts/production-chunks.json")
const indexPath = resolve("dist/index.html")
const chunks = JSON.parse(await readFile(reportPath, "utf8")) as ChunkReport[]
const indexHtml = await readFile(indexPath, "utf8")
const initialScript = /<script[^>]+src="\/([^"]+\.js)"/.exec(indexHtml)?.[1]
if (!initialScript) throw new Error(`Unable to find the initial module script in ${indexPath}`)

const initialChunk = chunks.find((chunk) => chunk.fileName === initialScript)
if (!initialChunk) throw new Error(`Initial chunk ${initialScript} is missing from ${reportPath}`)

const neoViewChunks = chunks.filter((chunk) => chunk.modules.some((module) => /[/\\]src[/\\]nodes[/\\]neoview[/\\]/i.test(module)))
if (neoViewChunks.length !== 1) {
  throw new Error(`Expected one NeoView app chunk, found ${neoViewChunks.length}: ${neoViewChunks.map((chunk) => chunk.fileName).join(", ")}`)
}
const neoViewChunk = neoViewChunks[0]!
if (neoViewChunk.bytes > 40 * 1024) {
  throw new Error(`NeoView app chunk ${neoViewChunk.fileName} is ${neoViewChunk.bytes} bytes, above 40 KiB.`)
}

const initialNeoViewModules = initialChunk.modules.filter((module) => /[/\\]neoview[/\\]/i.test(module))
if (initialNeoViewModules.length) {
  throw new Error(`NeoView leaked into initial chunk ${initialScript}: ${initialNeoViewModules.join(", ")}`)
}

const zipModules = chunks.flatMap((chunk) => chunk.modules
  .filter((module) => /@zip\.js|[/\\]zip\.js[/\\]/i.test(module))
  .map((module) => `${chunk.fileName}: ${module}`))
if (zipModules.length) throw new Error(`zip.js leaked into the frontend build:\n${zipModules.join("\n")}`)

console.log(JSON.stringify({
  initialChunk: { fileName: initialChunk.fileName, bytes: initialChunk.bytes, neoviewModules: 0 },
  neoviewChunk: { fileName: neoViewChunk.fileName, bytes: neoViewChunk.bytes },
  zipJsFrontendModules: 0,
}, null, 2))
