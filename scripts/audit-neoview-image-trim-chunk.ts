#!/usr/bin/env bun
// [neoview.image-trim.chunk]
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

interface ChunkReport { fileName: string; bytes: number; modules: string[] }

const chunks = JSON.parse(await readFile(resolve("artifacts/production-chunks.json"), "utf8")) as ChunkReport[]
const find = (pattern: RegExp) => chunks.find((chunk) => chunk.modules.some((module) => pattern.test(module)))
const entry = find(/[/\\]src[/\\]nodes[/\\]neoview[/\\]entry\.tsx?$/i)
const sidebar = find(/[/\\]features[/\\]panels[/\\]ReaderSidebar\.tsx$/i)
const card = find(/[/\\]features[/\\]panels[/\\]cards[/\\]ImageTrimCard\.tsx$/i)
const store = find(/[/\\]features[/\\]image-trim[/\\]ReaderImageTrimStore\.ts$/i)
const detector = find(/[/\\]features[/\\]image-trim[/\\]ReaderImageTrimDetector\.ts$/i)
const frame = find(/[/\\]features[/\\]reader[/\\]ReaderFrame\.tsx$/i)
if (!entry || !sidebar || !card || !store || !detector || !frame) throw new Error("Image trim production chunks are incomplete.")
if (card === entry || card === sidebar) throw new Error("ImageTrimCard leaked into the Reader entry or sidebar chunk.")
if (detector === entry || detector === sidebar || detector === card || detector === store || detector === frame) {
  throw new Error("ReaderImageTrimDetector did not produce an independent action-only chunk.")
}
if (card.bytes > 16 * 1024) throw new Error(`ImageTrimCard chunk is ${card.bytes} bytes, above 16 KiB.`)
if (detector.bytes > 8 * 1024) throw new Error(`ReaderImageTrimDetector chunk is ${detector.bytes} bytes, above 8 KiB.`)
const browserExternals = new Set([card, detector].flatMap((chunk) => chunk.modules.filter((module) => /^node:|__vite-browser-external/i.test(module))))
if (browserExternals.size) throw new Error(`Node-only modules leaked into image trim chunks: ${[...browserExternals].join(", ")}`)

console.log(`Image trim chunk audit passed: Card ${card.bytes} bytes, detector ${detector.bytes} bytes.`)
