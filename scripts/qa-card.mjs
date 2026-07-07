#!/usr/bin/env node
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url))
const DEFAULT_URL = process.env.XIRANITE_QA_URL ?? "http://127.0.0.1:5173/?workspace=ws-default"
const VIEW_MODES = new Set(["cards", "dockview", "flow", "lane", "bento"])
const CARD_LAYOUTS = new Set(["grid", "stack", "split", "focus"])
const SURFACES = new Set(["collapsed", "compact", "portrait", "regular", "expanded", "workspace"])
const DEFAULT_MATRIX_SURFACES = ["collapsed", "compact", "portrait", "expanded"]
const BENTO_MATRIX_LAYOUTS = {
  collapsed: { x: 0, y: 0, w: 3, h: 2 },
  compact: { x: 3, y: 0, w: 5, h: 3 },
  portrait: { x: 9, y: 0, w: 3, h: 10 },
  regular: { x: 0, y: 3, w: 7, h: 4 },
  expanded: { x: 0, y: 10, w: 8, h: 7 },
  workspace: { x: 0, y: 17, w: 12, h: 9 },
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.command === "help") {
    printUsage()
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
      const screenshotPath = options.output ?? defaultScreenshotPath(options)
      await mkdir(path.dirname(screenshotPath), { recursive: true })
      process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY ??= "1"
      await page.screenshot({ path: screenshotPath, fullPage: false })
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

function parseArgs(argv) {
  const positional = []
  const options = {
    command: "stage",
    url: DEFAULT_URL,
    waitBackend: true,
    timeoutMs: 15_000,
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
      case "--output":
        options.output = path.resolve(value())
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
      default:
        throw new Error(`Unknown option: ${flag}`)
    }
  }

  const first = positional[0]
  if (!first || first === "help") {
    options.command = "help"
    return options
  }
  if (first === "state" || first === "list") {
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
      ({ moduleId, surfaces, layouts }) => {
        const qa = window.__xiraniteQA
        if (!qa) throw new Error("window.__xiraniteQA is not available. Run the app in dev mode.")
        qa.hideView("bento")
        const created = []
        for (const [index, surface] of surfaces.entries()) {
          const bento = layouts[surface]
          let selected
          if (index === 0) {
            selected = qa.stage(moduleId, { view: "bento", surface, bento, collapsed: false, fresh: true }).selected
          } else {
            const beforeIds = new Set(qa.components().map((component) => component.id))
            qa.deploy(moduleId, "bento")
            selected = [...qa.components()]
              .reverse()
              .find((component) => component.moduleId === moduleId && !beforeIds.has(component.id))
          }
          if (!selected) throw new Error(`Failed to stage ${moduleId} ${surface}`)
          qa.stage(selected.id, { view: "bento", surface, bento, collapsed: false })
          created.push({ ...selected, surface, bento })
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
    } else {
      await page.getByText(modulePattern).first().waitFor({ state: "visible", timeout: renderWaitMs })
    }
    await page.waitForTimeout(250)
  } catch {
    console.warn(`staged module ${result.selected.moduleId} was not visibly rendered after ${renderWaitMs}ms; screenshot may show a loading shell`)
  }
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
  return path.resolve(REPO_ROOT, "artifacts", "qa-card", `${name}.png`)
}

function parseViewMode(value) {
  if (!VIEW_MODES.has(value)) throw new Error(`Invalid view mode: ${value}`)
  return value
}

function parseCardLayout(value) {
  if (!CARD_LAYOUTS.has(value)) throw new Error(`Invalid card layout: ${value}`)
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

Examples:
  bun scripts/qa-card.ts repacku bento expanded --fresh --screenshot
  bun scripts/qa-card.ts recycleu matrix --screenshot
  bun scripts/qa-card.ts enginev flow workspace --flow-pos 80,80 --viewport 1280x860 --screenshot
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
  --screenshot           Save a screenshot under artifacts/qa-card
  --output PATH          Screenshot path
  --headed               Show the browser
  --keep-open            Keep the QA browser open
  --full                 Print the full stage result instead of only selected component
  --no-wait-backend      Do not wait for workspace backend hydration before staging
  --json JSON            Merge raw stage options into window.__xiraniteQA.stage()
`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
