#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { chromium, type ConsoleMessage, type Page } from "@playwright/test"

const repoRoot = path.resolve(import.meta.dir, "..")
const defaultUrl = process.env.XIRANITE_QA_URL ?? "http://127.0.0.1:5173/?workspace=ws-default"
const generatedRegistryPath = path.join(repoRoot, "src", "components", "modules", "packageModules.generated.ts")

interface ExternalNode {
  id: string
  name: string
}

interface QaWindow {
  __xiraniteQA?: {
    hideView: (view: string) => void
    stage: (moduleId: string, options: Record<string, unknown>) => { selected?: { id?: string } }
    state: () => { backendReady?: boolean; fullscreenComponentId?: string | null }
  }
}

interface Options {
  url: string
  output: string
  viewport: { width: number; height: number }
  timeoutMs: number
  settleMs: number
  only: Set<string> | null
  headed: boolean
  waitBackend: boolean
  list: boolean
}

interface CaptureRecord {
  id: string
  name: string
  screenshot: string | null
  status: "captured" | "failed"
  consoleIssues: string[]
  error?: string
}

const options = parseArgs(process.argv.slice(2))
const allModules = await readExternalNodes(generatedRegistryPath)
const modules = allModules.filter((node) => !options.only || options.only.has(node.id))

if (options.list) {
  console.log(modules.map((node) => node.id).join("\n"))
  process.exit(0)
}

if (options.only) {
  const known = new Set(allModules.map((node) => node.id))
  const unknown = [...options.only].filter((id) => !known.has(id))
  if (unknown.length) throw new Error(`Unknown external node(s): ${unknown.join(", ")}`)
}

await mkdir(options.output, { recursive: true })
process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY ??= "1"

const browser = await chromium.launch({ headless: !options.headed })
const page = await browser.newPage({ viewport: options.viewport, deviceScaleFactor: 1 })
const issuesByNode = new Map<string, string[]>()
let activeNode = "startup"

page.on("console", (message) => collectConsoleIssue(issuesByNode, activeNode, message))
page.on("pageerror", (error) => pushIssue(issuesByNode, activeNode, `pageerror: ${error.message}`))

const records: CaptureRecord[] = []
try {
  await page.goto(options.url, { waitUntil: "domcontentloaded", timeout: options.timeoutMs })
  await page.waitForFunction(() => Boolean((window as unknown as QaWindow).__xiraniteQA), undefined, { timeout: options.timeoutMs })
  if (options.waitBackend) await waitForBackend(page, options.timeoutMs)

  for (const node of modules) {
    activeNode = node.id
    issuesByNode.set(node.id, [])
    const target = path.join(options.output, `${node.id}.png`)
    console.log(`capturing ${node.id}...`)
    try {
      const selected = await page.evaluate((moduleId) => {
        const qa = (window as unknown as QaWindow).__xiraniteQA
        if (!qa) throw new Error("window.__xiraniteQA is unavailable")
        qa.hideView("cards")
        const result = qa.stage(moduleId, {
          view: "cards",
          surface: "workspace",
          cardLayout: "focus",
          collapsed: false,
          focus: true,
          fullscreen: true,
          fresh: true,
        })
        return result.selected
      }, node.id)

      if (!selected?.id) throw new Error(`QA controller did not create ${node.id}`)
      const card = page.locator(`[data-component-id="${cssEscape(selected.id)}"]`).first()
      await card.waitFor({ state: "visible", timeout: options.timeoutMs })
      await page.waitForFunction(
        ({ componentId }) => (window as unknown as QaWindow).__xiraniteQA?.state().fullscreenComponentId === componentId,
        { componentId: selected.id },
        { timeout: options.timeoutMs },
      )
      await page.waitForTimeout(options.settleMs)
      await page.screenshot({ path: target, type: "png", fullPage: false })

      records.push({
        id: node.id,
        name: node.name,
        screenshot: path.relative(repoRoot, target).replaceAll("\\", "/"),
        status: "captured",
        consoleIssues: issuesByNode.get(node.id) ?? [],
      })
      console.log(`captured ${node.id} -> ${path.relative(repoRoot, target)}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      records.push({
        id: node.id,
        name: node.name,
        screenshot: null,
        status: "failed",
        consoleIssues: issuesByNode.get(node.id) ?? [],
        error: message,
      })
      console.error(`failed ${node.id}: ${message}`)
    }
  }
} finally {
  await browser.close()
}

const manifest = {
  generatedAt: new Date().toISOString(),
  source: options.url,
  viewport: options.viewport,
  total: records.length,
  captured: records.filter((record) => record.status === "captured").length,
  failed: records.filter((record) => record.status === "failed").length,
  records,
}
const manifestPath = path.join(options.output, "manifest.json")
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
console.log(`manifest -> ${path.relative(repoRoot, manifestPath)}`)
if (manifest.failed > 0) process.exitCode = 1

function parseArgs(args: string[]): Options {
  const parsed: Options = {
    url: defaultUrl,
    output: path.join(repoRoot, "output", "playwright", "node-gui-baselines"),
    viewport: { width: 1440, height: 900 },
    timeoutMs: 15_000,
    settleMs: 800,
    only: null,
    headed: false,
    waitBackend: true,
    list: false,
  }
  for (let index = 0; index < args.length; index += 1) {
    const [flag, inline] = (args[index] ?? "").split("=", 2)
    const value = () => inline ?? requireValue(args, ++index, flag)
    if (flag === "--url") parsed.url = value()
    else if (flag === "--output") parsed.output = path.resolve(value())
    else if (flag === "--viewport") parsed.viewport = parseViewport(value())
    else if (flag === "--timeout") parsed.timeoutMs = parsePositiveNumber(value(), flag)
    else if (flag === "--settle") parsed.settleMs = parsePositiveNumber(value(), flag)
    else if (flag === "--only") parsed.only = new Set(value().split(",").map((id) => id.trim()).filter(Boolean))
    else if (flag === "--headed") parsed.headed = true
    else if (flag === "--no-wait-backend") parsed.waitBackend = false
    else if (flag === "--list") parsed.list = true
    else if (flag === "--help" || flag === "-h") {
      printUsage()
      process.exit(0)
    } else throw new Error(`Unknown option: ${flag}`)
  }
  return parsed
}

function parseViewport(value: string) {
  const match = /^(\d+)x(\d+)$/.exec(value)
  if (!match) throw new Error(`Invalid viewport: ${value}`)
  return { width: Number(match[1]), height: Number(match[2]) }
}

function parsePositiveNumber(value: string, flag: string) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) throw new Error(`Invalid ${flag}: ${value}`)
  return number
}

function requireValue(args: string[], index: number, flag: string) {
  const value = args[index]
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`)
  return value
}

async function waitForBackend(page: Page, timeoutMs: number) {
  try {
    await page.waitForFunction(() => (window as unknown as QaWindow).__xiraniteQA?.state().backendReady === true, undefined, {
      timeout: Math.min(timeoutMs, 8_000),
    })
  } catch {
    console.warn("workspace backend is not ready; capturing the currently available GUI state")
  }
}

async function readExternalNodes(registryPath: string): Promise<ExternalNode[]> {
  const source = await readFile(registryPath, "utf8")
  const arraySource = source.match(/export const PACKAGE_MODULES = \[([\s\S]*?)\] satisfies NodeDef\[\]/)?.[1]
  if (!arraySource) throw new Error(`Could not read PACKAGE_MODULES from ${registryPath}`)
  const nodes: ExternalNode[] = []
  const itemPattern = /\{\s*id:\s*"([^"]+)",\s*name:\s*"([^"]+)"/g
  for (const match of arraySource.matchAll(itemPattern)) nodes.push({ id: match[1] ?? "", name: match[2] ?? "" })
  if (!nodes.length) throw new Error(`PACKAGE_MODULES is empty in ${registryPath}`)
  return nodes
}

function collectConsoleIssue(issues: Map<string, string[]>, nodeId: string, message: ConsoleMessage) {
  if (message.type() !== "error" && message.type() !== "warning") return
  if (message.text().includes("[xiranite qa]")) return
  pushIssue(issues, nodeId, `${message.type()}: ${message.text()}`)
}

function pushIssue(issues: Map<string, string[]>, nodeId: string, message: string) {
  const current = issues.get(nodeId) ?? []
  current.push(message)
  issues.set(nodeId, current)
}

function cssEscape(value: string) {
  return value.replace(/["\\]/g, "\\$&")
}

function printUsage() {
  console.log(`Capture fullscreen GUI baselines for every package/external node.

Usage:
  bun run qa:node-baselines
  bun run qa:node-baselines -- --only sleept,recycleu

Options:
  --url URL              Running Xiranite dev URL (default: ${defaultUrl})
  --output PATH          Baseline directory (default: output/playwright/node-gui-baselines)
  --viewport WxH         Screenshot viewport (default: 1440x900)
  --only ID,ID           Capture only selected package nodes
  --timeout MS           Per-navigation/render timeout (default: 15000)
  --settle MS            Stable-render delay before capture (default: 800)
  --no-wait-backend      Do not wait for desktop backend hydration
  --headed               Show the Playwright browser
  --list                 Print package node IDs without opening a browser
`)
}
