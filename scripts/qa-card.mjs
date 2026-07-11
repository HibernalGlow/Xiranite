#!/usr/bin/env node
import { access, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url))
const DEFAULT_URL = process.env.XIRANITE_QA_URL ?? "http://127.0.0.1:5173/?workspace=ws-default"
const VIEW_MODES = new Set(["cards", "dockview", "flow", "lane", "bento"])
const CARD_LAYOUTS = new Set(["grid", "stack", "split", "focus"])
const SURFACES = new Set(["collapsed", "compact", "portrait", "regular", "expanded", "workspace"])
const DEFAULT_MATRIX_SURFACES = ["collapsed", "compact", "portrait", "expanded"]
const REFERENCE_ALIASES = {
  gitalso: "diny_git",
  envuconfig: "envu",
  lata: "lata_taskfile",
  lorat: "lorat_lora_2",
  marku: "marku",
  scoolp: "scoolp_scoop_1",
  soundw: "songswitcher",
}
const REFERENCE_ROOTS = [
  path.resolve(REPO_ROOT, "ref", "stitch_wuling_city_40nodes_design (1)"),
  path.resolve(REPO_ROOT, "ref", "node3"),
]
const BENTO_MATRIX_LAYOUTS = {
  collapsed: { x: 0, y: 0, w: 3, h: 2 },
  compact: { x: 3, y: 0, w: 5, h: 3 },
  portrait: { x: 9, y: 0, w: 3, h: 10 },
  regular: { x: 0, y: 3, w: 7, h: 4 },
  expanded: { x: 0, y: 10, w: 8, h: 7 },
  workspace: { x: 0, y: 17, w: 12, h: 9 },
}

async function main() {
  const options = await parseArgs(process.argv.slice(2))
  if (options.command === "help") {
    printUsage()
    return
  }
  if (options.command === "references") {
    console.log(JSON.stringify(await referenceAudit(), null, 2))
    return
  }

  const browser = await chromium.launch({
    headless: !options.headed && !options.keepOpen,
  })
  const page = await browser.newPage({
    viewport: options.viewport ?? (options.command === "matrix" ? { width: 1600, height: 1700 } : { width: 1440, height: 900 }),
    deviceScaleFactor: 1,
  })
  const consoleIssues = []
  page.on("console", (message) => collectConsoleIssue(consoleIssues, message))
  page.on("pageerror", (error) => consoleIssues.push(`pageerror: ${error.message}`))

  try {
    await page.goto(options.url, { waitUntil: "domcontentloaded", timeout: options.timeoutMs })
    await waitForQaController(page, options.timeoutMs)
    if (options.waitBackend) await waitForWorkspaceBackend(page, options.timeoutMs)

    const result = await runQaCommand(page, options)
    console.log(JSON.stringify(printableResult(result, options), null, 2))

    if (options.screenshot || options.output) {
      await waitForStagedRender(page, result, options)
      if (options.openHelp) await openNodeHelp(page, result, options)
      const screenshotPath = options.output ?? defaultScreenshotPath(options)
      await mkdir(path.dirname(screenshotPath), { recursive: true })
      process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY ??= "1"
      const referencePath = await resolveReferencePath(options)
      if (referencePath) {
        await captureReferenceComparison(page, screenshotPath, referencePath, options)
        console.log(`reference: ${referencePath}`)
      } else {
        await captureScreenshot(page, screenshotPath, options)
      }
      console.log(`screenshot: ${screenshotPath}`)
    }

    if (consoleIssues.length) {
      console.warn("console issues:")
      for (const issue of consoleIssues) console.warn(`- ${issue}`)
    }

    if (options.keepOpen) {
      console.log("keep-open enabled; press Ctrl+C to close the QA browser.")
      await new Promise(() => undefined)
    }
  } finally {
    if (!options.keepOpen) await browser.close()
  }
}

async function parseArgs(argv) {
  const positional = []
  const options = {
    command: "stage",
    url: DEFAULT_URL,
    waitBackend: true,
    timeoutMs: 15_000,
    quality: 78,
    reference: "auto",
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith("--")) {
      positional.push(arg)
      continue
    }

    const [flag, inlineValue] = arg.split("=", 2)
    const value = () => inlineValue ?? requireValue(argv, ++index, flag)

    switch (flag) {
      case "--help":
      case "-h":
        options.command = "help"
        break
      case "--url":
        options.url = value()
        break
      case "--view":
        options.view = parseViewMode(value())
        break
      case "--surface":
      case "--size":
        options.surface = parseSurface(value())
        break
      case "--layout":
        options.cardLayout = parseCardLayout(value())
        break
      case "--matrix":
        options.command = "matrix"
        options.view = "bento"
        break
      case "--matrix-surfaces":
        options.matrixSurfaces = parseMatrixSurfaces(value())
        break
      case "--viewport":
        options.viewport = parseSize(value(), "viewport")
        break
      case "--flow":
        options.flow = { ...options.flow, ...parseFlowSize(value()) }
        break
      case "--flow-pos":
        options.flow = { ...options.flow, ...parsePosition(value(), "flow-pos") }
        break
      case "--bento":
        options.bento = { ...options.bento, ...parseBentoSize(value()) }
        break
      case "--bento-pos":
        options.bento = { ...options.bento, ...parseBentoPosition(value()) }
        break
      case "--fresh":
        options.fresh = true
        break
      case "--collapsed":
        options.collapsed = true
        break
      case "--expanded":
        options.collapsed = false
        break
      case "--focus":
        options.focus = true
        break
      case "--fullscreen":
        options.fullscreen = true
        break
      case "--screenshot":
        options.screenshot = true
        break
      case "--open-help":
        options.openHelp = true
        break
      case "--help-tab":
        options.openHelp = true
        options.helpTab = parseHelpTab(value())
        break
      case "--output":
        options.output = path.resolve(value())
        break
      case "--quality":
        options.quality = Number(value())
        if (!Number.isInteger(options.quality) || options.quality < 1 || options.quality > 100) {
          throw new Error(`Invalid --quality: ${options.quality}`)
        }
        break
      case "--reference":
        options.reference = value()
        break
      case "--no-reference":
        options.reference = false
        break
      case "--headed":
        options.headed = true
        break
      case "--keep-open":
        options.keepOpen = true
        break
      case "--full":
        options.full = true
        break
      case "--no-wait-backend":
        options.waitBackend = false
        break
      case "--timeout":
        options.timeoutMs = Number(value())
        if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
          throw new Error(`Invalid --timeout: ${options.timeoutMs}`)
        }
        break
      case "--json":
        options.rawOptions = JSON.parse(value())
        break
      case "--json-file":
        options.rawOptions = JSON.parse(await readFile(path.resolve(value()), "utf8"))
        break
      default:
        throw new Error(`Unknown option: ${flag}`)
    }
  }

  const first = positional[0]
  if (!first || first === "help") {
    options.command = "help"
    return options
  }
  if (first === "state" || first === "list" || first === "references") {
    options.command = first
    return options
  }

  options.moduleId = first
  if (positional[1] === "matrix") {
    options.command = "matrix"
    options.view = "bento"
    return options
  }
  if (positional[1]) options.view = parseViewMode(positional[1])
  if (positional[2]) options.surface = parseSurface(positional[2])
  return options
}

async function runQaCommand(page, options) {
  if (options.command === "state") {
    return page.evaluate(() => {
      const qa = window.__xiraniteQA
      if (!qa) throw new Error("window.__xiraniteQA is not available. Run the app in dev mode.")
      return qa.state()
    })
  }
  if (options.command === "list") {
    return page.evaluate(() => {
      const qa = window.__xiraniteQA
      if (!qa) throw new Error("window.__xiraniteQA is not available. Run the app in dev mode.")
      return qa.components()
    })
  }
  if (!options.moduleId) throw new Error("Missing module id.")

  if (options.command === "matrix") {
    return page.evaluate(
      async ({ moduleId, surfaces, layouts }) => {
        const qa = window.__xiraniteQA
        if (!qa) throw new Error("window.__xiraniteQA is not available. Run the app in dev mode.")
        qa.hideView("bento")
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        const created = []
        for (const [index, surface] of surfaces.entries()) {
          const bento = layouts[surface]
          let selected
          if (index === 0) {
            selected = qa.stage(moduleId, {
              view: "bento",
              surface,
              bento,
              collapsed: false,
              focus: false,
              fullscreen: false,
              fresh: true,
            }).selected
          } else {
            const beforeIds = new Set(qa.components().map((component) => component.id))
            qa.deploy(moduleId, "bento")
            selected = [...qa.components()]
              .reverse()
              .find((component) => component.moduleId === moduleId && !beforeIds.has(component.id))
          }
          if (!selected) throw new Error(`Failed to stage ${moduleId} ${surface}`)
          qa.stage(selected.id, {
            view: "bento",
            surface,
            bento,
            collapsed: false,
            focus: false,
            fullscreen: false,
          })
          created.push({ ...selected, surface, bento })
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        }
        qa.view("bento")
        return {
          ...qa.state(),
          matrix: created.map((item) => ({
            id: item.id,
            moduleId: item.moduleId,
            surface: item.surface,
            bentoLayout: item.bento,
          })),
        }
      },
      {
        moduleId: options.moduleId,
        surfaces: options.matrixSurfaces ?? DEFAULT_MATRIX_SURFACES,
        layouts: BENTO_MATRIX_LAYOUTS,
      },
    )
  }

  return page.evaluate(
    ({ moduleId, stageOptions }) => {
      const qa = window.__xiraniteQA
      if (!qa) throw new Error("window.__xiraniteQA is not available. Run the app in dev mode.")
      if (stageOptions.fresh && stageOptions.view) qa.hideView(stageOptions.view)
      return qa.stage(moduleId, stageOptions)
    },
    {
      moduleId: options.moduleId,
      stageOptions: {
        view: options.view,
        surface: options.surface,
        cardLayout: options.cardLayout,
        flow: options.flow,
        bento: options.bento,
        fresh: options.fresh,
        collapsed: options.collapsed,
        focus: options.focus,
        fullscreen: options.fullscreen,
        ...options.rawOptions,
      },
    },
  )
}

function printableResult(result, options) {
  if (options.command === "matrix" && result && typeof result === "object" && !options.full) {
    return {
      viewMode: result.viewMode,
      activeWorkspaceId: result.activeWorkspaceId,
      backendReady: result.backendReady,
      matrix: result.matrix,
    }
  }
  if (options.full || options.command !== "stage" || !result || typeof result !== "object") return result
  return {
    viewMode: result.viewMode,
    cardLayout: result.cardLayout,
    activeWorkspaceId: result.activeWorkspaceId,
    backendReady: result.backendReady,
    selected: result.selected,
  }
}

async function waitForQaController(page, timeoutMs) {
  await page.waitForFunction(
    () => Boolean(window.__xiraniteQA),
    undefined,
    { timeout: timeoutMs },
  )
}

async function waitForWorkspaceBackend(page, timeoutMs) {
  const backendWaitMs = Math.min(timeoutMs, 8_000)
  try {
    await page.waitForFunction(
      () => window.__xiraniteQA?.state?.().backendReady === true,
      undefined,
      { timeout: backendWaitMs },
    )
  } catch {
    console.warn(`workspace backend was not ready after ${backendWaitMs}ms; continuing with current UI state`)
  }
}

async function waitForStagedRender(page, result, options) {
  if (Array.isArray(result?.matrix) && result.matrix.length) {
    const renderWaitMs = Math.min(options.timeoutMs, 10_000)
    try {
      for (const item of result.matrix) {
        await page.locator(`[data-component-id="${cssEscape(item.id)}"]`).first().waitFor({ state: "visible", timeout: renderWaitMs })
      }
      await page.waitForTimeout(250)
    } catch {
      console.warn(`staged matrix was not fully rendered after ${renderWaitMs}ms; screenshot may show a partial layout`)
    }
    return
  }

  if (!result || typeof result !== "object" || !result.selected?.moduleId) {
    await page.waitForTimeout(250)
    return
  }

  const componentId = result.selected.id
  const modulePattern = new RegExp(escapeRegExp(result.selected.moduleId), "i")
  const renderWaitMs = Math.min(options.timeoutMs, options.view === "flow" ? 10_000 : 4_000)
  try {
    if (componentId) {
      await page.locator(`[data-component-id="${cssEscape(componentId)}"]`).first().waitFor({ state: "visible", timeout: renderWaitMs })
      await page.getByText(modulePattern).first().waitFor({ state: "visible", timeout: renderWaitMs })
    } else {
      await page.getByText(modulePattern).first().waitFor({ state: "visible", timeout: renderWaitMs })
    }
    await page.waitForTimeout(750)
  } catch {
    console.warn(`staged module ${result.selected.moduleId} was not visibly rendered after ${renderWaitMs}ms; screenshot may show a loading shell`)
  }
}

async function openNodeHelp(page, result, options) {
  const componentId = result?.selected?.id
  const root = componentId
    ? page.locator(`[data-component-id="${cssEscape(componentId)}"]`).first()
    : page
  const trigger = root.locator('[data-action-key="node-help"]').first()
  const waitMs = Math.min(options.timeoutMs, 4_000)
  await trigger.waitFor({ state: "attached", timeout: waitMs })
  await trigger.evaluate((element) => element.click())
  const sheet = page.locator('[data-slot="sheet-content"]').first()
  await sheet.waitFor({ state: "visible", timeout: waitMs })
  if (options.helpTab) {
    const tab = sheet.locator(`[data-help-tab="${cssEscape(options.helpTab)}"]`).first()
    await tab.waitFor({ state: "visible", timeout: waitMs })
    await tab.click()
  }
  await page.waitForTimeout(250)
}

function collectConsoleIssue(issues, message) {
  const type = message.type()
  if (type !== "error" && type !== "warning") return
  const text = message.text()
  if (text.includes("[xiranite qa]")) return
  issues.push(`${type}: ${text}`)
}

function defaultScreenshotPath(options) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const name = [
    stamp,
    options.moduleId ?? options.command,
    options.command === "matrix" ? "bento-matrix" : (options.view ?? "current"),
    options.command === "matrix" ? (options.matrixSurfaces ?? DEFAULT_MATRIX_SURFACES).join("_") : (options.surface ?? "default"),
  ].join("-")
  return path.resolve(REPO_ROOT, "artifacts", "qa-card", `${name}.jpg`)
}

async function resolveReferencePath(options) {
  if (!options.moduleId || options.reference === false) return undefined
  const candidate = options.reference === "auto"
    ? await findAutoReferencePath(options.moduleId)
    : path.resolve(options.reference)
  try {
    await access(candidate)
    return candidate
  } catch {
    if (options.reference !== "auto") throw new Error(`Reference image does not exist: ${candidate}`)
    return undefined
  }
}

async function findAutoReferencePath(moduleId) {
  const referenceId = REFERENCE_ALIASES[moduleId] ?? moduleId
  for (const referenceRoot of REFERENCE_ROOTS) {
    const direct = path.join(referenceRoot, referenceId, "screen.png")
    try {
      await access(direct)
      return direct
    } catch {
      try {
        const entries = await readdir(referenceRoot, { withFileTypes: true })
        const numbered = entries
          .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${referenceId}_`))
          .map((entry) => entry.name)
          .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
        const candidate = path.join(referenceRoot, numbered[0] ?? referenceId, "screen.png")
        await access(candidate)
        return candidate
      } catch {
        // The next reference pack may contain this node.
      }
    }
  }
  return undefined
}

async function referenceAudit() {
  const nodeRoot = path.resolve(REPO_ROOT, "src", "nodes")
  const modules = (await readdir(nodeRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name !== "shared")
    .map((entry) => entry.name)
    .sort()
  const records = await Promise.all(modules.map(async (moduleId) => {
    const referencePath = await resolveReferencePath({ moduleId, reference: "auto" })
    return {
      moduleId,
      reference: referencePath ? path.relative(REPO_ROOT, referencePath) : null,
      status: referencePath ? "ready" : "missing",
    }
  }))
  return {
    ready: records.filter((record) => record.status === "ready").length,
    missing: records.filter((record) => record.status === "missing").length,
    records,
  }
}

async function captureScreenshot(page, screenshotPath, options) {
  const usePng = path.extname(screenshotPath).toLowerCase() === ".png"
  await page.screenshot({
    path: screenshotPath,
    fullPage: false,
    type: usePng ? "png" : "jpeg",
    quality: usePng ? undefined : options.quality,
  })
}

async function captureReferenceComparison(page, screenshotPath, referencePath, options) {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "xiranite-qa-"))
  const currentPath = path.join(temporaryDirectory, "current.png")
  try {
    await page.screenshot({ path: currentPath, fullPage: false, type: "png" })
    const [referenceImage, currentImage] = await Promise.all([readFile(referencePath), readFile(currentPath)])
    const comparisonContext = await page.context().browser().newContext({ viewport: { width: 1600, height: 920 }, deviceScaleFactor: 1 })
    const comparison = await comparisonContext.newPage()
    try {
      await comparison.setContent(referenceComparisonDocument(
        imageDataUrl(referencePath, referenceImage),
        imageDataUrl(currentPath, currentImage),
        options.moduleId,
      ))
      await comparison.locator("img").last().waitFor({ state: "visible" })
      await comparison.waitForTimeout(100)
      await captureScreenshot(comparison, screenshotPath, options)
    } finally {
      await comparisonContext.close()
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

function referenceComparisonDocument(referenceUrl, currentUrl, moduleId) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; background: #101416; color: #edf3f0; font-family: ui-sans-serif, system-ui, sans-serif; }
  header { height: 56px; display: flex; align-items: center; justify-content: space-between; padding: 0 24px; border-bottom: 1px solid #30403b; background: #16201d; }
  h1 { margin: 0; font-size: 16px; letter-spacing: .04em; }
  p { margin: 0; color: #9aaba5; font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
  main { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; height: calc(100vh - 56px); padding: 12px; }
  figure { min-width: 0; min-height: 0; margin: 0; display: grid; grid-template-rows: 30px minmax(0, 1fr); border: 1px solid #30403b; background: #0b0f0e; overflow: hidden; }
  figcaption { display: flex; align-items: center; padding: 0 12px; background: #17201d; color: #b8c9c2; font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .08em; text-transform: uppercase; }
  img { width: 100%; height: 100%; object-fit: contain; object-position: top center; background: #080a09; }
</style></head><body>
  <header><h1>${escapeHtml(moduleId)} visual fidelity review</h1><p>reference ↔ current node UI</p></header>
  <main>
    <figure><figcaption>Reference design</figcaption><img src="${referenceUrl}" alt="Reference design" /></figure>
    <figure><figcaption>Current implementation</figcaption><img src="${currentUrl}" alt="Current implementation" /></figure>
  </main>
</body></html>`
}

function imageDataUrl(imagePath, content) {
  const extension = path.extname(imagePath).toLowerCase()
  const mediaType = extension === ".png" ? "image/png" : "image/jpeg"
  return `data:${mediaType};base64,${content.toString("base64")}`
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character])
}

function parseViewMode(value) {
  if (!VIEW_MODES.has(value)) throw new Error(`Invalid view mode: ${value}`)
  return value
}

function parseCardLayout(value) {
  if (!CARD_LAYOUTS.has(value)) throw new Error(`Invalid card layout: ${value}`)
  return value
}

function parseHelpTab(value) {
  if (!["overview", "workflows", "cli", "details"].includes(value)) {
    throw new Error(`Invalid help tab: ${value}`)
  }
  return value
}

function parseSurface(value) {
  if (!SURFACES.has(value)) throw new Error(`Invalid surface preset: ${value}`)
  return value
}

function parseMatrixSurfaces(value) {
  const surfaces = value.split(",").map((item) => parseMatrixSurface(item.trim())).filter(Boolean)
  if (!surfaces.length) throw new Error("Matrix surfaces cannot be empty.")
  return surfaces
}

function parseMatrixSurface(value) {
  return parseSurface(value)
}

function parseSize(value, label) {
  const match = value.match(/^(\d+)x(\d+)$/i)
  if (!match) throw new Error(`Invalid ${label}. Expected WIDTHxHEIGHT, got: ${value}`)
  return { width: Number(match[1]), height: Number(match[2]) }
}

function parseFlowSize(value) {
  return parseSize(value, "flow")
}

function parseBentoSize(value) {
  const size = parseSize(value, "bento")
  return { w: size.width, h: size.height }
}

function parsePosition(value, label) {
  const match = value.match(/^(-?\d+),(-?\d+)$/)
  if (!match) throw new Error(`Invalid ${label}. Expected X,Y, got: ${value}`)
  return { x: Number(match[1]), y: Number(match[2]) }
}

function parseBentoPosition(value) {
  return parsePosition(value, "bento-pos")
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function cssEscape(value) {
  return String(value).replace(/["\\]/g, "\\$&")
}

function requireValue(argv, index, flag) {
  const value = argv[index]
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`)
  return value
}

function printUsage() {
  console.log(`Xiranite card QA helper

Usage:
  bun scripts/qa-card.ts <module> [view] [surface] [options]
  bun scripts/qa-card.ts <module> matrix [options]
  bun run qa:card -- <module> [view] [surface] [options]
  node scripts/qa-card.mjs <module> [view] [surface] [options]
  bun scripts/qa-card.ts state
  bun scripts/qa-card.ts list
  bun scripts/qa-card.ts references

Examples:
  bun scripts/qa-card.ts repacku bento expanded --fresh --screenshot
  bun scripts/qa-card.ts recycleu matrix --screenshot
  bun scripts/qa-card.ts kavvka cards workspace --fresh --screenshot --output output/playwright/kavvka-review.jpg
  bun scripts/qa-card.ts enginev flow workspace --flow-pos 80,80 --viewport 1280x860 --screenshot
  bun scripts/qa-card.ts classq cards workspace --help-tab workflows --screenshot
  bun scripts/qa-card.ts recycleu cards compact --layout grid --viewport 420x360 --headed

Options:
  --url URL              Dev app URL. Default: ${DEFAULT_URL}
  --view MODE            cards | dockview | flow | lane | bento
  --surface NAME         collapsed | compact | portrait | regular | expanded | workspace
  --layout NAME          grid | stack | split | focus
  --matrix               Stage collapsed/compact/portrait/expanded in bento and screenshot once; portrait is a narrow, phone-like tall card
  --matrix-surfaces CSV  Matrix surfaces. Default: ${DEFAULT_MATRIX_SURFACES.join(",")}
  --viewport WxH         Browser viewport size, for example 720x520
  --flow WxH             Flow card size in pixels
  --flow-pos X,Y         Flow card position
  --bento WxH            Bento widget size in grid units
  --bento-pos X,Y        Bento widget position in grid units
  --fresh                Remove existing active component(s) for this module first
  --collapsed            Collapse the component
  --expanded             Expand the component
  --focus                Focus the card in cards view
  --fullscreen           Open the card fullscreen in cards view
  --screenshot           Save a screenshot under artifacts/qa-card; when a reference exists, save a labelled side-by-side comparison
  --reference PATH|auto  Reference image for comparison. Default: auto-resolve ref/stitch_wuling_city_40nodes_design (1)/<module>/screen.png
  --no-reference         Capture only the current UI, without a comparison panel
  --open-help            Open the staged node's shared help sheet before capture
  --help-tab NAME        Open overview | workflows | cli | details before capture
  --output PATH          Screenshot path
  --quality 1-100        JPEG quality. Default: 78; ignored for explicit .png output
  --headed               Show the browser
  --keep-open            Keep the QA browser open
  --full                 Print the full stage result instead of only selected component
  --no-wait-backend      Do not wait for workspace backend hydration before staging
  --json JSON            Merge raw stage options into window.__xiraniteQA.stage()
  --json-file PATH       Read raw stage options from a JSON file

Reference audit:
  references            List every app-owned node and its auto-resolved reference image
`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
