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
const neoViewChunk = neoViewChunks.find((chunk) => chunk.modules.some((module) => /[/\\]src[/\\]nodes[/\\]neoview[/\\]entry\.tsx?$/i.test(module)))
if (!neoViewChunk) throw new Error(`Unable to find the NeoView entry chunk among: ${neoViewChunks.map((chunk) => chunk.fileName).join(", ")}`)
if (neoViewChunk.bytes > 40 * 1024) {
  throw new Error(`NeoView app chunk ${neoViewChunk.fileName} is ${neoViewChunk.bytes} bytes, above 40 KiB.`)
}

const eagerPanelModules = neoViewChunk.modules.filter((module) => /[/\\]features[/\\]panels[/\\](?:ReaderSidebar|cards[/\\])/i.test(module))
if (eagerPanelModules.length) throw new Error(`NeoView panel/card modules leaked into the reader entry chunk: ${eagerPanelModules.join(", ")}`)
const deferredPanelChunks = neoViewChunks.filter((chunk) => chunk !== neoViewChunk && chunk.modules.some((module) => /[/\\]features[/\\]panels[/\\]/i.test(module)))
if (!deferredPanelChunks.some((chunk) => chunk.modules.some((module) => /[/\\]features[/\\]panels[/\\]ReaderSidebar\.tsx$/i.test(module)))) {
  throw new Error("NeoView ReaderSidebar did not produce a deferred production chunk.")
}
if (!deferredPanelChunks.some((chunk) => chunk.modules.some((module) => /[/\\]features[/\\]panels[/\\]cards[/\\]/i.test(module)))) {
  throw new Error("NeoView cards did not produce deferred production chunks.")
}
for (const chunk of deferredPanelChunks) {
  if (chunk.bytes > 32 * 1024) throw new Error(`NeoView deferred panel chunk ${chunk.fileName} is ${chunk.bytes} bytes, above 32 KiB.`)
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
  deferredPanelChunks: deferredPanelChunks.map((chunk) => ({ fileName: chunk.fileName, bytes: chunk.bytes })),
  zipJsFrontendModules: 0,
}, null, 2))
