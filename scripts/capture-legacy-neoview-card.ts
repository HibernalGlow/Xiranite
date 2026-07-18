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
  await page.goto(options.url, { waitUntil: "domcontentloaded", timeout: 30_000 })
  console.log("page loaded")
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
  if (!url || !output) throw new Error("Usage: capture-legacy-neoview-card.ts --url=<url> --output=<png> [--wait-label=<label> | --check-label=<label> | --click-selector=<selector>] [--probe-module=<path>] [--viewport=1920x1080]")
  const [width, height] = (values.get("--viewport") ?? "1920x1080").split("x").map(Number)
  if (!Number.isInteger(width) || !Number.isInteger(height) || width! <= 0 || height! <= 0) throw new Error("Invalid viewport")
  return {
    url,
    output: resolve(output),
    waitLabel: values.get("--wait-label"),
    checkLabel: values.get("--check-label"),
    clickSelector: values.get("--click-selector"),
    probeModule: values.get("--probe-module"),
    viewport: { width: width!, height: height! },
  }
}
