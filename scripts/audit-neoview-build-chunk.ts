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

const settingsWindowChunk = neoViewChunks.find((chunk) => chunk.modules.some((module) => /[/\\]features[/\\]settings[/\\]ReaderSettingsWindow\.tsx$/i.test(module)))
const sidebarManagementSettingsCardChunk = neoViewChunks.find((chunk) => chunk.modules.some((module) => /[/\\]features[/\\]settings[/\\]cards[/\\]SidebarManagementSettingsCard\.tsx$/i.test(module)))
const panelLayoutEditorChunk = neoViewChunks.find((chunk) => chunk.modules.some((module) => /[/\\]features[/\\]settings[/\\]cards[/\\]PanelLayoutEditor\.tsx$/i.test(module)))
const kanbanRuntimeChunk = chunks.find((chunk) => chunk.modules.some((module) => /[/\\]src[/\\]components[/\\]ui[/\\]kanban\.tsx$/i.test(module)))
if (!settingsWindowChunk) throw new Error("NeoView settings window did not produce a deferred production chunk.")
if (!sidebarManagementSettingsCardChunk) throw new Error("NeoView SidebarManagementSettingsCard did not produce a deferred production chunk.")
if (!panelLayoutEditorChunk) throw new Error("NeoView PanelLayoutEditor did not produce a second-level deferred production chunk.")
if (!kanbanRuntimeChunk) throw new Error("Dice UI Kanban runtime chunk is missing from the PanelLayoutEditor build.")
if (settingsWindowChunk === panelLayoutEditorChunk) throw new Error("NeoView PanelLayoutEditor leaked into the base settings window chunk.")
if (initialChunk === kanbanRuntimeChunk || neoViewChunk === kanbanRuntimeChunk || settingsWindowChunk === kanbanRuntimeChunk) {
  throw new Error("Dice UI Kanban runtime leaked into an eager NeoView/initial/settings-window chunk.")
}
if (panelLayoutEditorChunk.bytes > 64 * 1024) throw new Error(`NeoView PanelLayoutEditor chunk ${panelLayoutEditorChunk.fileName} is ${panelLayoutEditorChunk.bytes} bytes, above 64 KiB.`)
if (sidebarManagementSettingsCardChunk.bytes > 16 * 1024) throw new Error(`NeoView SidebarManagementSettingsCard chunk ${sidebarManagementSettingsCardChunk.fileName} is ${sidebarManagementSettingsCardChunk.bytes} bytes, above 16 KiB.`)
if (kanbanRuntimeChunk.bytes > 64 * 1024) throw new Error(`Dice UI Kanban runtime chunk ${kanbanRuntimeChunk.fileName} is ${kanbanRuntimeChunk.bytes} bytes, above 64 KiB.`)
const ordinaryReaderChunks = [neoViewChunk, ...deferredPanelChunks.filter((chunk) => chunk.modules.some((module) => /[/\\]features[/\\]panels[/\\]ReaderSidebar\.tsx$/i.test(module)))]
const eagerEditorModules = ordinaryReaderChunks.flatMap((chunk) => chunk.modules
  .filter((module) => /[/\\]features[/\\]settings[/\\]|@dnd-kit|[/\\]components[/\\]ui[/\\]kanban\.tsx$/i.test(module))
  .map((module) => `${chunk.fileName}: ${module}`))
if (eagerEditorModules.length) throw new Error(`NeoView settings/Kanban modules leaked into the ordinary reader path:\n${eagerEditorModules.join("\n")}`)

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
  settingsWindowChunk: { fileName: settingsWindowChunk.fileName, bytes: settingsWindowChunk.bytes },
  sidebarManagementSettingsCardChunk: { fileName: sidebarManagementSettingsCardChunk.fileName, bytes: sidebarManagementSettingsCardChunk.bytes },
  panelLayoutEditorChunk: { fileName: panelLayoutEditorChunk.fileName, bytes: panelLayoutEditorChunk.bytes },
  kanbanRuntimeChunk: { fileName: kanbanRuntimeChunk.fileName, bytes: kanbanRuntimeChunk.bytes },
  zipJsFrontendModules: 0,
}, null, 2))
