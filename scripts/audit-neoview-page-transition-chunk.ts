#!/usr/bin/env bun
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

interface ChunkReport { fileName: string; bytes: number; modules: string[] }

const chunks = JSON.parse(await readFile(resolve("artifacts/production-chunks.json"), "utf8")) as ChunkReport[]
const find = (pattern: RegExp) => chunks.find((chunk) => chunk.modules.some((module) => pattern.test(module)))
const entry = find(/[/\\]src[/\\]nodes[/\\]neoview[/\\]entry\.tsx?$/i)
const sidebar = find(/[/\\]features[/\\]panels[/\\]ReaderSidebar\.tsx$/i)
const card = find(/[/\\]features[/\\]panels[/\\]cards[/\\]PageTransitionCard\.tsx$/i)
const domain = find(/[/\\]domain[/\\]page-transition[/\\]ReaderPageTransition\.(?:js|ts)$/i)
const layer = find(/[/\\]features[/\\]page-transition[/\\]ReaderPageTransitionLayer\.tsx$/i)
const frame = find(/[/\\]features[/\\]reader[/\\]ReaderFrame\.tsx$/i)
if (!entry || !sidebar || !card || !domain || !layer || !frame) throw new Error("Page transition production chunks are incomplete.")
if (card === entry || card === sidebar) throw new Error("PageTransitionCard leaked into the Reader entry or sidebar chunk.")
if (domain === sidebar) throw new Error("ReaderPageTransition leaked into the base sidebar chunk.")
if (layer !== frame) throw new Error("ReaderPageTransitionLayer is not colocated with the deferred ReaderFrame.")
if (card.bytes > 8 * 1024) throw new Error(`PageTransitionCard chunk is ${card.bytes} bytes, above 8 KiB.`)
if (domain.bytes > 8 * 1024) throw new Error(`ReaderPageTransition domain chunk is ${domain.bytes} bytes, above 8 KiB.`)
if (frame.bytes > 16 * 1024) throw new Error(`ReaderFrame chunk is ${frame.bytes} bytes, above 16 KiB.`)
const browserExternals = new Set([card, domain, frame].flatMap((chunk) => chunk.modules.filter((module) => /^node:|__vite-browser-external/i.test(module))))
if (browserExternals.size) throw new Error(`Node-only modules leaked into page transition chunks: ${[...browserExternals].join(", ")}`)

console.log(`Page transition chunk audit passed: Card ${card.bytes} bytes, domain ${domain.bytes} bytes, ReaderFrame ${frame.bytes} bytes.`)
