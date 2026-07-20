#!/usr/bin/env bun
// [neoview.book-information.lazy-chunk]
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

interface ChunkReport { fileName: string; bytes: number; modules: string[] }

const chunks = JSON.parse(await readFile(resolve("artifacts/production-chunks.json"), "utf8")) as ChunkReport[]
const find = (pattern: RegExp) => chunks.find((chunk) => chunk.modules.some((module) => pattern.test(module)))
const entry = find(/[/\\]src[/\\]nodes[/\\]neoview[/\\]entry\.tsx?$/i)
const sidebar = find(/[/\\]features[/\\]panels[/\\]ReaderSidebar\.tsx$/i)
const card = find(/[/\\]features[/\\]panels[/\\]cards[/\\]BookInformationCard\.tsx$/i)
const projection = find(/[/\\](?:src|dist)[/\\]domain[/\\]book[/\\]BookInformationProjection\.(?:ts|js)$/i)

if (!entry || !sidebar || !card || !projection) throw new Error("Book information production chunks are incomplete.")
if (card === entry || card === sidebar) throw new Error("BookInformationCard leaked into the Reader entry or sidebar chunk.")
if (projection === entry || projection === sidebar) throw new Error("BookInformationProjection leaked into the Reader entry or sidebar chunk.")
if (card.bytes > 8 * 1024) throw new Error(`BookInformationCard chunk is ${card.bytes} bytes, above 8 KiB.`)
if (projection.bytes > 8 * 1024) throw new Error(`BookInformationProjection chunk is ${projection.bytes} bytes, above 8 KiB.`)

const browserExternals = new Set([card, projection].flatMap((chunk) => (
  chunk.modules.filter((module) => /^node:|__vite-browser-external/i.test(module))
)))
if (browserExternals.size) {
  throw new Error(`Node-only modules leaked into book information chunks: ${[...browserExternals].join(", ")}`)
}

console.log(`Book information chunk audit passed: Card ${card.bytes} bytes, projection ${projection.bytes} bytes.`)
