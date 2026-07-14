#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { chromium } from "playwright"

const url = process.env.XIRANITE_QA_URL ?? "http://127.0.0.1:5173/?workspace=ws-default"
const outputRoot = path.resolve("output", "playwright")
const screenshotPath = path.join(outputRoot, "czkawka-portrait-interaction.png")
const reportPath = path.join(outputRoot, "czkawka-qa-report.json")
const browser = await chromium.launch({ headless: process.env.XIRANITE_QA_HEADED !== "1" })
const page = await browser.newPage({ viewport: { width: 900, height: 860 }, deviceScaleFactor: 1 })
page.setDefaultTimeout(8_000)
const consoleErrors = []
const consoleWarnings = []
page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`))
page.on("console", (message) => {
  if (message.text().includes("[xiranite qa]")) return
  if (message.type() === "error") consoleErrors.push(`console: ${message.text()}`)
  if (message.type() === "warning") consoleWarnings.push(message.text())
})

try {
  console.log("[qa-czkawka] open")
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 })
  await page.waitForFunction(() => window.__xiraniteQA?.state().backendReady === true, undefined, { timeout: 20_000 })
  console.log("[qa-czkawka] stage")
  const staged = await page.evaluate(() => window.__xiraniteQA.stage("czkawka", {
    fresh: true,
    view: "flow",
    surface: "portrait",
    flow: { x: 30, y: 30, width: 420, height: 720 },
    data: {
      tool: "duplicate-files",
      includedDirectoriesText: "D:/Photos\nE:/Archive",
      includedDirectoriesReferencedText: "E:/Archive",
      excludedDirectoriesText: "D:/Photos/cache",
      excludedItemsText: "*/cache/*;*.part",
      allowedExtensions: "jpg,png,IMAGE",
      phase: "idle",
      progressText: "Czkawka 已就绪。",
    },
  }))
  const componentId = staged.selected?.id
  if (!componentId) throw new Error("Czkawka QA staging did not return a component id")
  const root = page.locator(`[data-component-id="${componentId}"]`).first()
  await root.waitFor({ state: "visible", timeout: 10_000 })
  await root.getByTestId("czkawka-compact-view").waitFor({ state: "visible" })

  console.log("[qa-czkawka] switch tool")
  const primary = root.getByRole("button", { name: "开始扫描" })
  await primary.waitFor({ state: "visible" })
  await root.getByRole("button", { name: "相似图片" }).click()
  await root.getByText("Czkawka · 相似图片", { exact: true }).waitFor({ state: "visible" })
  console.log("[qa-czkawka] references")
  await root.getByRole("button", { name: "全部设为参考目录" }).click()
  await root.getByRole("button", { name: "取消全部参考目录" }).waitFor({ state: "visible" })
  await root.getByRole("button", { name: "管理卡片" }).click()
  await page.getByRole("dialog").waitFor({ state: "visible" })
  await page.keyboard.press("Escape")
  await root.getByRole("tab", { name: /结果/ }).click()
  console.log("[qa-czkawka] result tab")
  await root.getByText("添加目录并开始扫描。").waitFor({ state: "visible" })

  console.log("[qa-czkawka] measure")
  await primary.focus()
  await page.keyboard.press("Tab")
  const measurements = await root.evaluate((element) => {
    const surface = element.querySelector('[data-testid="czkawka-surface"]')
    const start = [...element.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === "开始扫描" || button.textContent?.includes("开始扫描"))
    if (!(surface instanceof HTMLElement) || !(start instanceof HTMLElement)) throw new Error("Missing Czkawka surface or primary action")
    const surfaceRect = surface.getBoundingClientRect()
    const startRect = start.getBoundingClientRect()
    const unlabeledControls = [...surface.querySelectorAll("button,input,textarea,select")].filter((control) => {
      if (!(control instanceof HTMLElement) || control.hidden || control.getAttribute("aria-hidden") === "true") return false
      const labelledBy = control.getAttribute("aria-labelledby")?.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ") ?? ""
      const labels = "labels" in control && control.labels ? [...control.labels].map((label) => label.textContent ?? "").join(" ") : ""
      return ![control.getAttribute("aria-label"), control.getAttribute("title"), control.textContent, labelledBy, labels].some((value) => value?.trim())
    }).map((control) => `${control.tagName.toLowerCase()}#${control.id || "-"}.${control.className}`)
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      documentOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      surface: { width: surfaceRect.width, height: surfaceRect.height, scrollWidth: surface.scrollWidth, scrollHeight: surface.scrollHeight, mode: surface.dataset.surfaceMode, measuredWidth: surface.dataset.surfaceWidth },
      primaryRect: { left: startRect.left, right: startRect.right, top: startRect.top, bottom: startRect.bottom },
      primaryFullyVisible: startRect.left >= surfaceRect.left && startRect.right <= surfaceRect.right && startRect.top >= surfaceRect.top && startRect.bottom <= surfaceRect.bottom,
      activeElement: document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent?.trim().slice(0, 80) ?? "",
      unlabeledControls,
    }
  })
  console.log(JSON.stringify(measurements, null, 2))
  if (measurements.documentOverflowX > 1) throw new Error(`Document horizontally overflows by ${measurements.documentOverflowX}px`)
  if (!measurements.primaryFullyVisible) throw new Error("Primary scan action is clipped on the portrait surface")
  if (measurements.unlabeledControls.length) throw new Error(`Unlabelled interactive controls: ${measurements.unlabeledControls.join(", ")}`)
  if (consoleErrors.length) throw new Error(`Console is not healthy:\n${consoleErrors.join("\n")}`)

  await mkdir(outputRoot, { recursive: true })
  await root.screenshot({ path: screenshotPath })
  const report = { componentId, interaction: { switchedTool: "similar-images", referencesSelected: 2, tabsVisited: ["results"] }, measurements, consoleErrors, consoleWarnings, screenshotPath }
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  console.log(JSON.stringify(report, null, 2))
} finally {
  await browser.close()
}
