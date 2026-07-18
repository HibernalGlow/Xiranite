#!/usr/bin/env bun
// [neoview.switch-toast.chunk]
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

interface ChunkReport { fileName: string; bytes: number; modules: string[] }

const chunks = JSON.parse(await readFile(resolve("artifacts/production-chunks.json"), "utf8")) as ChunkReport[]
const find = (pattern: RegExp) => chunks.find((chunk) => chunk.modules.some((module) => pattern.test(module)))
const entry = find(/[/\\]src[/\\]nodes[/\\]neoview[/\\]entry\.tsx?$/i)
const sidebar = find(/[/\\]features[/\\]panels[/\\]ReaderSidebar\.tsx$/i)
const card = find(/[/\\]features[/\\]panels[/\\]cards[/\\]SwitchToastCard\.tsx$/i)
const domain = find(/[/\\]application[/\\]switch-toast[/\\]ReaderSwitchToast\.(?:js|ts)$/i)
const runtime = find(/[/\\]features[/\\]switch-toast[/\\]ReaderSwitchToastRuntime\.tsx$/i)
const host = find(/[/\\]features[/\\]switch-toast[/\\]ReaderSwitchToastHost\.tsx$/i)
if (!entry || !sidebar || !card || !domain || !runtime || !host) throw new Error("Switch toast production chunks are incomplete.")
if (card === entry || card === sidebar) throw new Error("SwitchToastCard leaked into the Reader entry or sidebar chunk.")
if (runtime !== host) throw new Error("Switch toast Host is not colocated with the deferred runtime chunk.")
if (runtime === sidebar) throw new Error("Switch toast runtime leaked into the base sidebar chunk.")
if (card.bytes > 16 * 1024) throw new Error(`SwitchToastCard chunk is ${card.bytes} bytes, above 16 KiB.`)
if (runtime.bytes > 12 * 1024) throw new Error(`Switch toast runtime chunk is ${runtime.bytes} bytes, above 12 KiB.`)
if (domain.bytes > 16 * 1024) throw new Error(`Switch toast domain host chunk is ${domain.bytes} bytes, above 16 KiB.`)
const browserExternals = new Set([card, domain, runtime].flatMap((chunk) => chunk.modules.filter((module) => /^node:|__vite-browser-external/i.test(module))))
if (browserExternals.size) throw new Error(`Node-only modules leaked into switch toast chunks: ${[...browserExternals].join(", ")}`)

console.log(`Switch toast chunk audit passed: Card ${card.bytes} bytes, runtime ${runtime.bytes} bytes, domain host ${domain.bytes} bytes.`)
