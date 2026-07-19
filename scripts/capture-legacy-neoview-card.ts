#!/usr/bin/env bun
import { mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { chromium } from "playwright"

const options = parseArgs(process.argv.slice(2))
console.log(`launching ${options.viewport.width}x${options.viewport.height}`)
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: options.viewport, deviceScaleFactor: 1 })
  page.on("pageerror", (error) => console.error(`pageerror: ${error.message}`))
  page.on("console", (message) => {
    if (message.type() === "error") console.error(`console: ${message.text()}`)
  })
  console.log(`opening ${options.url}`)
  await page.goto(options.url, { waitUntil: options.waitUntil, timeout: 30_000 })
  console.log("page loaded")
  if (options.legacyCard) {
    await mountLegacyCard(page, options.legacyCard, options.legacySetup)
    console.log(`mounted legacy card ${options.legacyCard} (${options.legacySetup})`)
  }
  if (options.probeModule) {
    const probe = await page.evaluate(async (modulePath) => {
      try {
        const module = await import(/* @vite-ignore */ modulePath)
        return `ok keys=${Object.keys(module).join(",")} default=${Boolean(module.default)}`
      } catch (error) {
        return error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ""}` : String(error)
      }
    }, options.probeModule)
    console.log(`module probe: ${probe}`)
  }
  if (options.expandConditions) {
    const expand = page.getByRole("button", { name: "展开条件编辑器" })
    await expand.waitFor({ state: "visible", timeout: 30_000 })
    await expand.click()
    await page.getByText("匹配规则", { exact: true }).first().waitFor({ state: "visible", timeout: 30_000 })
  }
  if (options.waitLabel) {
    const label = page.getByText(options.waitLabel, { exact: true }).first()
    await label.waitFor({ state: "visible", timeout: 30_000 })
    console.log(`found ${options.waitLabel}`)
  } else if (options.checkLabel) {
    const label = page.getByText(options.checkLabel, { exact: true }).first()
    await label.waitFor({ state: "visible", timeout: 30_000 })
    await label.click()
    console.log(`clicked ${options.checkLabel}`)
  } else if (options.clickSelector) {
    const target = page.locator(options.clickSelector).first()
    await target.waitFor({ state: "visible", timeout: 30_000 })
    await target.click()
    console.log(`clicked ${options.clickSelector}`)
  }
  if (options.waitMs > 0) await page.waitForTimeout(options.waitMs)
  await Promise.race([
    page.evaluate(() => document.fonts.ready),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ])
  await mkdir(dirname(options.output), { recursive: true })
  await page.screenshot({ path: options.output, fullPage: false })
  console.log(options.output)
} finally {
  await browser.close()
}

function parseArgs(args: readonly string[]) {
  const values = new Map(args.map((argument) => {
    const separator = argument.indexOf("=")
    return separator < 0 ? [argument, ""] : [argument.slice(0, separator), argument.slice(separator + 1)]
  }))
  const url = values.get("--url")
  const output = values.get("--output")
  if (!url || !output) throw new Error("Usage: capture-legacy-neoview-card.ts --url=<url> --output=<png> [--legacy-card=<id> --legacy-setup=control|model|status|cache|conditions --expand-conditions] [--wait-label=<label> | --check-label=<label> | --click-selector=<selector>] [--wait-ms=<ms>] [--wait-until=commit|domcontentloaded] [--probe-module=<path>] [--viewport=1920x1080]")
  const [width, height] = (values.get("--viewport") ?? "1920x1080").split("x").map(Number)
  if (!Number.isInteger(width) || !Number.isInteger(height) || width! <= 0 || height! <= 0) throw new Error("Invalid viewport")
  return {
    url,
    output: resolve(output),
    waitLabel: values.get("--wait-label"),
    waitMs: Number(values.get("--wait-ms") ?? 0),
    waitUntil: values.get("--wait-until") === "commit" ? "commit" as const : "domcontentloaded" as const,
    checkLabel: values.get("--check-label"),
    clickSelector: values.get("--click-selector"),
    expandConditions: values.has("--expand-conditions"),
    legacyCard: values.get("--legacy-card"),
    legacySetup: values.get("--legacy-setup") ?? "control",
    probeModule: values.get("--probe-module"),
    viewport: { width: width!, height: height! },
  }
}

async function mountLegacyCard(
  page: import("playwright").Page,
  cardId: string,
  setup: string,
): Promise<void> {
  await page.evaluate(async ({ cardId, setup }) => {
    const load = (path: string): Promise<any> => import(/* @vite-ignore */ path)
    const store = await load("/src/lib/stores/upscale/upscalePanelStore.svelte.ts")
    if (setup === "model") {
      store.isPyO3Available.value = true
      store.availableModels.value = ["MODEL_WAIFU2X_CUNET_UP2X", "MODEL_REALCUGAN_PRO_UP3X", "ILLUSJANAI_DAT2_X4"]
      store.selectedModel.value = "MODEL_WAIFU2X_CUNET_UP2X"
      store.tileEnabled.value = true
      store.tileSize.value = 256
    } else if (setup === "status") {
      const { upscaleStore } = await load("/src/lib/stackview/stores/upscaleStore.svelte.ts")
      upscaleStore.setEnabled(true)
    } else if (setup === "cache") {
      store.cacheStats.value = { totalFiles: 48, totalSize: 384 * 1024 * 1024, cacheDir: "D:/NeoView/cache/pyo3-upscale" }
    } else if (setup === "conditions") {
      const { getDefaultConditionPresets } = await load("/src/lib/utils/upscale/conditions.ts")
      store.autoUpscaleEnabled.value = true
      store.conditionalUpscaleEnabled.value = true
      store.conditionsList.value = getDefaultConditionPresets()
    }
    const [{ mount }, { default: CardRenderer }] = await Promise.all([
      load("/node_modules/.vite/deps/svelte.js"),
      load("/src/lib/cards/CardRenderer.svelte"),
    ])
    const width = setup === "conditions" ? 760 : 380
    document.body.innerHTML = `<main style="width: ${width}px; margin: 48px; color: var(--foreground)"><div id="legacy-card"></div></main>`
    mount(CardRenderer, {
      target: document.getElementById("legacy-card")!,
      props: { cardId, panelId: "upscale" },
    })
  }, { cardId, setup })
}
