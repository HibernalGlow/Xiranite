#!/usr/bin/env bun
// [neoview.time-information.lazy-chunk]
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

interface ChunkReport { fileName: string; bytes: number; modules: string[] }

const chunks = JSON.parse(await readFile(resolve("artifacts/production-chunks.json"), "utf8")) as ChunkReport[]
const find = (pattern: RegExp) => chunks.find((chunk) => chunk.modules.some((module) => pattern.test(module)))
const entry = find(/[/\\]src[/\\]nodes[/\\]neoview[/\\]entry\.tsx?$/i)
const sidebar = find(/[/\\]features[/\\]panels[/\\]ReaderSidebar\.tsx$/i)
const card = find(/[/\\]features[/\\]panels[/\\]cards[/\\]TimeInformationCard\.tsx$/i)
const projection = find(/[/\\](?:src|dist)[/\\]domain[/\\]page[/\\]TimeInformationProjection\.(?:ts|js)$/i)

if (!entry || !sidebar || !card || !projection) throw new Error("Time information production chunks are incomplete.")
if (card === entry || card === sidebar) throw new Error("TimeInformationCard leaked into the Reader entry or sidebar chunk.")
if (projection === entry || projection === sidebar) throw new Error("TimeInformationProjection leaked into the Reader entry or sidebar chunk.")
if (card.bytes > 8 * 1024) throw new Error(`TimeInformationCard chunk is ${card.bytes} bytes, above 8 KiB.`)
if (projection.bytes > 8 * 1024) throw new Error(`TimeInformationProjection chunk is ${projection.bytes} bytes, above 8 KiB.`)

const browserExternals = new Set([card, projection].flatMap((chunk) => (
  chunk.modules.filter((module) => /^node:|__vite-browser-external/i.test(module))
)))
if (browserExternals.size) {
  throw new Error(`Node-only modules leaked into time information chunks: ${[...browserExternals].join(", ")}`)
}

console.log(`Time information chunk audit passed: Card ${card.bytes} bytes, projection ${projection.bytes} bytes.`)
