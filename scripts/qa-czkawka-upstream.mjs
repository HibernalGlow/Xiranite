import { mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { chromium } from "playwright"

const url = process.argv[2] ?? "http://127.0.0.1:5000"
const output = resolve(process.argv[3] ?? "output/playwright/czkawka-upstream.png")
await mkdir(dirname(output), { recursive: true })

const browser = await chromium.launch({ channel: "msedge", headless: true })
const page = await browser.newPage({ viewport: { width: 1920, height: 1300 }, deviceScaleFactor: 1 })
const consoleIssues = []
page.on("console", (message) => {
  if (["error", "warning"].includes(message.type())) consoleIssues.push(`${message.type()}: ${message.text()}`)
})
page.on("pageerror", (error) => consoleIssues.push(`pageerror: ${error.message}`))

await page.addInitScript(() => {
  let invokeDelegate
  const internals = {
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { windowLabel: "main", label: "main" },
    },
  }
  Object.defineProperty(internals, "invoke", {
    configurable: true,
    get() {
      return async (command, args, options) => {
        if (command === "get_thumbnail_cache_stats") return [0, 0]
        if (command.includes("is_maximized")) return false
        return invokeDelegate?.(command, args, options)
      }
    },
    set(value) { invokeDelegate = value },
  })
  window.__TAURI_INTERNALS__ = internals
})

await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 })
await page.locator("#root").waitFor({ state: "visible" })
await page.screenshot({ path: output, fullPage: true })
const result = {
  url,
  output,
  title: await page.title(),
  bodyText: (await page.locator("body").innerText()).slice(0, 500),
  consoleIssues,
}
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
await browser.close()
