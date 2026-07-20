#!/usr/bin/env bun
// [neoview.storage-information.lazy-chunk]
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

interface ChunkReport { fileName: string; bytes: number; modules: string[] }

const chunks = JSON.parse(await readFile(resolve("artifacts/production-chunks.json"), "utf8")) as ChunkReport[]
const find = (pattern: RegExp) => chunks.find((chunk) => chunk.modules.some((module) => pattern.test(module)))
const entry = find(/[/\\]src[/\\]nodes[/\\]neoview[/\\]entry\.tsx?$/i)
const sidebar = find(/[/\\]features[/\\]panels[/\\]ReaderSidebar\.tsx$/i)
const card = find(/[/\\]features[/\\]panels[/\\]cards[/\\]StorageInformationCard\.tsx$/i)

if (!entry || !sidebar || !card) throw new Error("Storage information production chunks are incomplete.")
if (card === entry || card === sidebar) throw new Error("StorageInformationCard leaked into the Reader entry or sidebar chunk.")
if (card.bytes > 8 * 1024) throw new Error(`StorageInformationCard chunk is ${card.bytes} bytes, above 8 KiB.`)

const browserExternals = card.modules.filter((module) => /^node:|__vite-browser-external/i.test(module))
if (browserExternals.length) {
  throw new Error(`Node-only modules leaked into storage information chunk: ${browserExternals.join(", ")}`)
}

console.log(`Storage information chunk audit passed: Card ${card.bytes} bytes.`)
