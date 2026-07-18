import { test, expect, type Page } from "@playwright/test"
import { randomUUID } from "node:crypto"
import { execFileSync } from "node:child_process"
import { access, mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { createMemoryWorkspaceRepository } from "@xiranite/repository"
import { startBackend } from "../../packages/backend/src/index"

const RUN_ROOT = path.resolve("artifacts/test-runs/browser-node-e2e")
const WORKSPACE_ID = "ws-default"
const ENGINEV_REAL_WORKSHOP_PATH = process.env.XIRANITE_ENGINEV_REAL_WORKSHOP_PATH ?? "E:\\SteamLibrary\\steamapps\\workshop\\content\\431960"
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lV9uKAAAAABJRU5ErkJggg==",
  "base64",
)

// @xiranite-real-run bandia
// @xiranite-real-run cleanf
// @xiranite-real-run crashu
// @xiranite-real-run dissolvef
// @xiranite-real-run encodeb
// @xiranite-real-run enginev
// @xiranite-real-run findz
// @xiranite-real-run formatv
// @xiranite-real-run kavvka
// @xiranite-real-run lata
// @xiranite-real-run linedup
// @xiranite-real-run linku
// @xiranite-real-run marku
// @xiranite-real-run migratef
// @xiranite-real-run movea
// @xiranite-real-run mvz
// @xiranite-real-run owithu
// @xiranite-real-run rawfilter
// @xiranite-real-run recycleu
// @xiranite-real-run repacku
// @xiranite-real-run scoolp
// @xiranite-real-run seriex
// @xiranite-real-run sleept
// @xiranite-real-run trename

test.describe.configure({ mode: "serial" })

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "real node click smoke only runs once on the desktop viewport")
})

test("cleanf card clicks through real backend operation stream", async ({ page }) => {
  const backend = await startBackend({ token: "node-browser-test-token", repository: createMemoryWorkspaceRepository() })
  const root = await createFixture("cleanf")
  try {
    await writeFile(path.join(root, "old.bak"), "backup", "utf8")
    await seedNode(backend, "cleanf", {
      pathText: root,
      selectedPresets: ["backup_files"],
      previewMode: true,
      logs: [],
    })
    await openApp(page, backend)
    await clickButton(page, /运行|Run/i)
    await expect(page.getByText(/completed/i)).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(/Cleanf completed|completed/i)).toBeVisible()
    await expect(page.getByText(/old\.bak/)).toBeVisible()
  } finally {
    backend.close()
    await rm(root, { recursive: true, force: true })
  }
})

test("rawfilter card plans real archive files", async ({ page }) => {
  const backend = await startBackend({ token: "node-browser-test-token", repository: createMemoryWorkspaceRepository() })
  const root = await createFixture("rawfilter")
  try {
    await writeFile(path.join(root, "画集 [translated].zip"), "translated", "utf8")
    await writeFile(path.join(root, "画集 [raw].zip"), "raw", "utf8")
    await seedNode(backend, "rawfilter", {
      pathText: root,
      nameOnlyMode: false,
      createShortcuts: false,
      trashOnly: false,
      minSimilarity: 0.5,
      logs: [],
    })
    await openApp(page, backend)
    await clickButton(page, /计划|Plan/i)
    await expect(page.getByText(/completed/i)).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(/pending\s+trash.*\[raw\]\.zip/i)).toBeVisible()
  } finally {
    backend.close()
    await rm(root, { recursive: true, force: true })
  }
})

test("marku card runs text mode through real backend", async ({ page }) => {
  const backend = await startBackend({ token: "node-browser-test-token", repository: createMemoryWorkspaceRepository() })
  try {
    await seedNode(backend, "marku", {
      inputText: "# 标题\n## 子标题\n正文\n",
      module: "markt",
      dryRun: true,
      enableUndo: true,
      logs: [],
    })
    await openApp(page, backend)
    await clickButton(page, /运行|Run/i)
    await expect(page.getByText(/completed/i)).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(/Marku completed|completed/i)).toBeVisible()
  } finally {
    backend.close()
  }
})

test("crashu card plans real source and target folders", async ({ page }) => {
  const backend = await startBackend({ token: "node-browser-test-token", repository: createMemoryWorkspaceRepository() })
  const root = await createFixture("crashu")
  try {
    const sourceRoot = path.join(root, "source")
    const targetRoot = path.join(root, "targets")
    const destinationRoot = path.join(root, "destination")
    await mkdir(path.join(sourceRoot, "蜂蜜作品 [Alt Name]"), { recursive: true })
    await mkdir(path.join(targetRoot, "Alt Name"), { recursive: true })
    await mkdir(destinationRoot, { recursive: true })
    await seedNode(backend, "crashu", {
      sourcePathsText: sourceRoot,
      targetPath: targetRoot,
      destinationPath: destinationRoot,
      similarityThreshold: 0.6,
      autoMove: false,
      logs: [],
    })
    await openApp(page, backend)
    await clickButton(page, /计划|Plan/i)
    await expect(page.getByText(/completed/i)).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(/Alt Name/)).toBeVisible()
  } finally {
    backend.close()
    await rm(root, { recursive: true, force: true })
  }
})

test("linedup card filters real text data in the browser", async ({ page }) => {
  const backend = await startBackend({ token: "node-browser-test-token", repository: createMemoryWorkspaceRepository() })
  try {
    await seedNode(backend, "linedup", {
      sourceText: "alpha\nremove me\nbeta\n",
      filterText: "remove\n",
    })
    await openApp(page, backend)
    await clickButton(page, /^(过滤|Filter)$/i)
    await expect(page.getByText(/kept=2 removed=1/)).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText("-remove me")).toBeVisible()
  } finally {
    backend.close()
  }
})

test("repacku card analyzes a real folder tree", async ({ page }) => {
  const backend = await startBackend({ token: "node-browser-test-token", repository: createMemoryWorkspaceRepository() })
  const root = await createFixture("repacku")
  try {
    const album = path.join(root, "作品 一")
    await mkdir(album, { recursive: true })
    await writeFile(path.join(album, "001.png"), "png", "utf8")
    await writeFile(path.join(album, "002.jpg"), "jpg", "utf8")
    await seedNode(backend, "repacku", {
      path: root,
      minCount: 2,
      dryRun: true,
      logs: [],
    })
    await openApp(page, backend)
    await clickButton(page, /分析|Analyze/i)
    await expect(page.getByText(/Analysis complete: 2 folder/i)).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(/entire\s+作品 一/)).toBeVisible()
  } finally {
    backend.close()
    await rm(root, { recursive: true, force: true })
  }
})

test("sleept card runs a dry-run countdown through real backend", async ({ page }) => {
  const backend = await startBackend({ token: "node-browser-test-token", repository: createMemoryWorkspaceRepository() })
  try {
    await seedNode(backend, "sleept", {
      timerMode: "countdown",
      powerMode: "sleep",
      hours: 0,
      minutes: 0,
      seconds: 1,
      dryrun: true,
    })
    await openApp(page, backend)
    await clickButton(page, /启动|Start/i)
    await expect(page.getByText(/\[dryrun\] Countdown completed; simulated sleep\./i)).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText("completed", { exact: true })).toBeVisible()
  } finally {
    backend.close()
  }
})

test("recycleu card clears only a scoped C drive recycle-bin fixture", async ({ page }) => {
  const cBefore = recycleCounts().C ?? 0
  test.skip(cBefore !== 0, `C: recycle bin already has ${cBefore} item(s); refusing to clear user-owned C: recycle bin entries`)

  const backend = await startBackend({ token: "node-browser-test-token", repository: createMemoryWorkspaceRepository() })
  const testFile = await createCDriveRecycleBinFixture()
  try {
    expect(recycleCounts().C).toBe(1)
    await seedNode(backend, "recycleu", {
      interval: 5,
      maxCycles: 1,
      driveLetter: "C",
      logs: [],
    })
    await openApp(page, backend)
    await clickButton(page, /启动|Start/i)
    await expect(page.getByText("completed", { exact: true })).toBeVisible({ timeout: 25_000 })
    await expect(page.getByText(/Recycle bin emptied for drive C:/)).toBeVisible()
    expect(recycleCounts().C ?? 0).toBe(0)
  } finally {
    backend.close()
    await rm(path.dirname(testFile), { recursive: true, force: true })
  }
})

test("bandia card dry-runs extraction for a real archive path", async ({ page }) => {
  const backend = await startBackend({ token: "node-browser-test-token", repository: createMemoryWorkspaceRepository() })
  const root = await createFixture("bandia")
  try {
    const archive = path.join(root, "book.zip")
    await writeFile(archive, "zip", "utf8")
    await seedNode(backend, "bandia", {
      mode: "extract",
      pathText: archive,
      extractMode: "normal",
      outputPrefix: "[x] ",
      dryRun: true,
      logs: [],
    })
    await openApp(page, backend)
    await clickButton(page, /^(运行|Run)$/i)
    await expectText(page, /Extract complete: 1 succeeded, 0 failed\./i, 20_000)
    await expectText(page, /book\.zip/)
  } finally {
    backend.close()
    await rm(root, { recursive: true, force: true })
  }
})

test("dissolvef card plans a real direct dissolve folder", async ({ page }) => {
  const backend = await startBackend({ token: "node-browser-test-token", repository: createMemoryWorkspaceRepository() })
  const root = await createFixture("dissolvef")
  try {
    const source = path.join(root, "bundle")
    await mkdir(source, { recursive: true })
    await writeFile(path.join(source, "page-001.jpg"), "jpg", "utf8")
    await seedNode(backend, "dissolvef", {
      pathText: source,
      direct: true,
      preview: true,
      logs: [],
    })
    await openApp(page, backend)
    await clickButton(page, /^(计划|Plan)$/i)
    await expectText(page, /Plan generated: \d+ operation/i, 20_000)
    await expectText(page, /page-001\.jpg/)
  } finally {
    backend.close()
    await rm(root, { recursive: true, force: true })
  }
})

test("encodeb card finds a real suspicious filename", async ({ page }) => {
  const backend = await startBackend({ token: "node-browser-test-token", repository: createMemoryWorkspaceRepository() })
  const root = await createFixture("encodeb")
  try {
    await writeFile(path.join(root, "╘.txt"), "garbled", "utf8")
    await seedNode(backend, "encodeb", {
      pathText: root,
      logs: [],
    })
    await openApp(page, backend)
    await clickButton(page, /^(查找|Find)$/i)
    await expectText(page, /Find completed, 1 item/i, 20_000)
    await expectText(page, /╘\.txt/)
  } finally {
    backend.close()
    await rm(root, { recursive: true, force: true })
  }
})

test("enginev card scans a real Wallpaper Engine project folder", async ({ page }) => {
  const backend = await startBackend({ token: "node-browser-test-token", repository: createMemoryWorkspaceRepository() })
  const root = await createFixture("enginev")
  try {
    const project = path.join(root, "111")
    await mkdir(project, { recursive: true })
    await writeFile(path.join(project, "project.json"), JSON.stringify({
      title: "Ocean Loop",
      description: "calm motion",
      contentrating: "Everyone",
      preview: "preview.png",
      type: "Video",
      tags: ["test"],
    }), "utf8")
    await writeFile(path.join(project, "preview.png"), ONE_PIXEL_PNG)
    await seedNode(backend, "enginev", {
      workshopPath: root,
      logs: [],
    })
    await openApp(page, backend)
    await clickButton(page, /^(扫描|Scan)$/i)
    await expectText(page, /Scan complete: 1 wallpaper/i, 20_000)
    await expectText(page, /Ocean Loop/)
    await expectImageLoaded(page, /Ocean Loop/)
  } finally {
    backend.close()
    await rm(root, { recursive: true, force: true })
  }
})

test("enginev card renders local preview images from the real Workshop library", async ({ page }) => {
  test.setTimeout(180_000)
  test.skip(!await pathExists(ENGINEV_REAL_WORKSHOP_PATH), `Workshop path not found: ${ENGINEV_REAL_WORKSHOP_PATH}`)

  const backend = await startBackend({ token: "node-browser-test-token", repository: createMemoryWorkspaceRepository() })
  try {
    await seedNode(backend, "enginev", {
      workshopPath: ENGINEV_REAL_WORKSHOP_PATH,
      logs: [],
    })
    await openApp(page, backend)
    await clickButton(page, /^(扫描|Scan)$/i)
    await expectText(page, /Scan complete: \d+ wallpaper/i, 120_000)
    const image = page.locator("img[data-enginev-preview='true']").first()
    await expect(image).toBeVisible({ timeout: 60_000 })
    const imageSrc = await image.getAttribute("src")
    expect(imageSrc).toBeTruthy()
    const imageUrl = new URL(imageSrc!)
    expect(imageUrl.protocol).toMatch(/^https?:$/)
    expect(imageUrl.pathname).toBe("/local-files")
    expect(imageUrl.searchParams.get("token")).toBe(backend.token)
    expect(normalizeFsPath(imageUrl.searchParams.get("path") ?? "").toLowerCase()
      .startsWith(normalizeFsPath(ENGINEV_REAL_WORKSHOP_PATH).toLowerCase())).toBe(true)
    await expectImageResponse(page, imageSrc!)
    await expect.poll(async () => await image.evaluate((node) => (node as HTMLImageElement).naturalWidth), {
      timeout: 60_000,
    }).toBeGreaterThan(0)
  } finally {
    backend.close()
  }
})

test("findz card searches real files through the backend", async ({ page }) => {
  const backend = await startBackend({ token: "node-browser-test-token", repository: createMemoryWorkspaceRepository() })
  const root = await createFixture("findz")
  try {
    await writeFile(path.join(root, "a.jpg"), "jpg", "utf8")
    await writeFile(path.join(root, "b.txt"), "txt", "utf8")
    await writeFile(path.join(root, "c.png"), "png", "utf8")
    await seedNode(backend, "findz", {
      action: "search",
      pathText: root,
      where: 'ext IN ("jpg", "png")',
      noArchive: true,
      logs: [],
    })
    await openApp(page, backend)
    await clickButton(page, /^(运行|Run)$/i)
    await expectText(page, /Found 2 item/i, 20_000)
    await expectText(page, /a\.jpg/)
    await expectText(page, /c\.png/)
  } finally {
    backend.close()
    await rm(root, { recursive: true, force: true })
  }
})

test("formatv card scans real video filenames", async ({ page }) => {
  const backend = await startBackend({ token: "node-browser-test-token", repository: createMemoryWorkspaceRepository() })
  const root = await createFixture("formatv")
  try {
    await writeFile(path.join(root, "clip.mp4"), "mp4", "utf8")
    await writeFile(path.join(root, "hidden.mkv.nov"), "mkv", "utf8")
    await seedNode(backend, "formatv", {
      pathText: root,
      dryRun: true,
      logs: [],
    })
    await openApp(page, backend)
    await clickButton(page, /^(扫描|Scan)$/i)
    await expectText(page, /Scan completed: 1 normal, 1 \.nov/i, 20_000)
    await expectText(page, /clip\.mp4/)
  } finally {
    backend.close()
    await rm(root, { recursive: true, force: true })
  }
})

test("kavvka card scans real keyword folders", async ({ page }) => {
  const backend = await startBackend({ token: "node-browser-test-token", repository: createMemoryWorkspaceRepository() })
  const root = await createFixture("kavvka")
  try {
    await mkdir(path.join(root, "artist gallery"), { recursive: true })
    await mkdir(path.join(root, "notes"), { recursive: true })
    await seedNode(backend, "kavvka", {
      scanRootText: root,
      keywordText: "gallery",
      scanDepth: 2,
      logs: [],
    })
    await openApp(page, backend)
    await clickButton(page, /^(扫描|Scan)$/i)
    await expectText(page, /Scan completed: 1 matching folder/i, 20_000)
    await expectText(page, /artist gallery/)
  } finally {
    backend.close()
    await rm(root, { recursive: true, force: true })
  }
})

test("lata card loads a real Taskfile without executing commands", async ({ page }) => {
  const backend = await startBackend({ token: "node-browser-test-token", repository: createMemoryWorkspaceRepository() })
  const root = await createFixture("lata")
  try {
    const taskfile = path.join(root, "Taskfile.yml")
    await writeFile(taskfile, [
      "version: '3'",
      "tasks:",
      "  default:",
      "    desc: demo task",
      "    cmds:",
      "      - echo hello",
      "",
    ].join("\n"), "utf8")
    await seedNode(backend, "lata", {
      taskfilePath: taskfile,
      logs: [],
    })
    await openApp(page, backend)
    await clickButton(page, /^(加载|Load)$/i)
    await expectText(page, /Found 1 task/i, 20_000)
    await expectText(page, /default \/ 1 cmd/)
  } finally {
    backend.close()
    await rm(root, { recursive: true, force: true })
  }
})

test("linku card reads real path info without creating links", async ({ page }) => {
  const backend = await startBackend({ token: "node-browser-test-token", repository: createMemoryWorkspaceRepository() })
  const root = await createFixture("linku")
  try {
    await seedNode(backend, "linku", {
      path: root,
      logs: [],
    })
    await openApp(page, backend)
    await clickButton(page, /^(信息|Info)$/i)
    await expectText(page, /Path info loaded\./i, 20_000)
    await expectText(page, /exists.*true/i)
  } finally {
    backend.close()
    await rm(root, { recursive: true, force: true })
  }
})

test("migratef card plans a real file migration without moving files", async ({ page }) => {
  const backend = await startBackend({ token: "node-browser-test-token", repository: createMemoryWorkspaceRepository() })
  const root = await createFixture("migratef")
  try {
    const source = path.join(root, "source")
    const target = path.join(root, "target")
    await mkdir(source, { recursive: true })
    await mkdir(target, { recursive: true })
    await writeFile(path.join(source, "a.txt"), "a", "utf8")
    await seedNode(backend, "migratef", {
      sourceText: source,
      targetPath: target,
      mode: "flat",
      logs: [],
    })
    await openApp(page, backend)
    await clickButton(page, /^(计划|Plan)$/i)
    await expectText(page, /Plan generated: 1 item/i, 20_000)
    await expectText(page, /a\.txt/)
  } finally {
    backend.close()
    await rm(root, { recursive: true, force: true })
  }
})

test("movea card scans a real first-level folder layout", async ({ page }) => {
  const backend = await startBackend({ token: "node-browser-test-token", repository: createMemoryWorkspaceRepository() })
  const root = await createFixture("movea")
  try {
    const artist = path.join(root, "artist")
    await mkdir(path.join(artist, "loose"), { recursive: true })
    await writeFile(path.join(artist, "book.zip"), "zip", "utf8")
    await seedNode(backend, "movea", {
      rootPath: root,
      regexText: "book",
      logs: [],
    })
    await openApp(page, backend)
    await clickButton(page, /^(扫描|Scan)$/i)
    await expectText(page, /Scan completed: 1 folder\(s\), 1 archive/i, 20_000)
    await expectText(page, /artist/)
  } finally {
    backend.close()
    await rm(root, { recursive: true, force: true })
  }
})

test("mvz card previews archive extraction commands without 7-Zip", async ({ page }) => {
  const backend = await startBackend({ token: "node-browser-test-token", repository: createMemoryWorkspaceRepository() })
  const root = await createFixture("mvz")
  try {
    const archive = path.join(root, "book.zip")
    await seedNode(backend, "mvz", {
      action: "extract",
      entryText: `${archive}//page/001.jpg`,
      dryRun: true,
      logs: [],
    })
    await openApp(page, backend)
    await clickButton(page, /^(运行|Run)$/i)
    await expectText(page, /extract complete: 1 succeeded, 0 failed/i, 20_000)
    await expectText(page, /page\/001\.jpg|page\\001\.jpg/)
  } finally {
    backend.close()
    await rm(root, { recursive: true, force: true })
  }
})

test("owithu card previews registry operations from TOML", async ({ page }) => {
  const backend = await startBackend({ token: "node-browser-test-token", repository: createMemoryWorkspaceRepository() })
  try {
    await seedNode(backend, "owithu", {
      configText: sampleOwithuToml(),
      logs: [],
    })
    await openApp(page, backend)
    await clickButton(page, /^(预览|Preview)$/i)
    await expectText(page, /Found 1 entries and 3 registry operations/i, 20_000)
    await expectText(page, /VSCode/)
  } finally {
    backend.close()
  }
})

test("scoolp card scans real Scoop cache files through the backend", async ({ page }) => {
  const backend = await startBackend({ token: "node-browser-test-token", repository: createMemoryWorkspaceRepository() })
  const root = await createFixture("scoolp")
  try {
    await writeFile(path.join(root, "demo#1.0#old"), "old", "utf8")
    await writeFile(path.join(root, "demo#2.0#new"), "new", "utf8")
    await writeFile(path.join(root, "other#1.0#new"), "other", "utf8")
    await seedNode(backend, "scoolp", {
      action: "cache_list",
      path: root,
      dryRun: true,
      logs: [],
    })
    await openApp(page, backend)
    await clickButton(page, /^(运行|Run)$/i)
    await expectText(page, /Found 1 obsolete cache file/i, 20_000)
    await expectText(page, /demo\s+1\.0/i)
  } finally {
    backend.close()
    await rm(root, { recursive: true, force: true })
  }
})

test("seriex card plans real series folders", async ({ page }) => {
  const backend = await startBackend({ token: "node-browser-test-token", repository: createMemoryWorkspaceRepository() })
  const root = await createFixture("seriex")
  try {
    await writeFile(path.join(root, "Alpha 01.mp4"), "mp4", "utf8")
    await writeFile(path.join(root, "Alpha 02.mp4"), "mp4", "utf8")
    await writeFile(path.join(root, "Beta 01.mp4"), "mp4", "utf8")
    await writeFile(path.join(root, "Beta 02.mp4"), "mp4", "utf8")
    await seedNode(backend, "seriex", {
      directoryPath: root,
      prefix: "[#s]",
      logs: [],
    })
    await openApp(page, backend)
    await clickButton(page, /^(计划|Plan)$/i)
    await expectText(page, /Plan generated: 2 series, 4 file/i, 20_000)
    await expectText(page, /\[#s\]Alpha/)
  } finally {
    backend.close()
    await rm(root, { recursive: true, force: true })
  }
})

test("trename card scans a real folder into rename JSON", async ({ page }) => {
  const backend = await startBackend({ token: "node-browser-test-token", repository: createMemoryWorkspaceRepository() })
  const root = await createFixture("trename")
  try {
    await writeFile(path.join(root, "image-a.jpg"), "jpg", "utf8")
    await seedNode(backend, "trename", {
      pathText: root,
      includeRoot: true,
      compact: true,
      dryRun: true,
      logs: [],
    })
    await openApp(page, backend)
    await clickButton(page, /^(扫描|Scan)$/i)
    await expectText(page, /Scan complete: \d+ item/i, 20_000)
    await expectText(page, /image-a\.jpg/)
  } finally {
    backend.close()
    await rm(root, { recursive: true, force: true })
  }
})

async function openApp(page: Page, backend: Awaited<ReturnType<typeof startBackend>>): Promise<void> {
  await page.addInitScript((config) => {
    ;(window as typeof window & { __XIRANITE_BACKEND__?: unknown }).__XIRANITE_BACKEND__ = config
  }, { baseUrl: backend.url, token: backend.token })
  await page.goto("/", { waitUntil: "domcontentloaded" })
  await expect(page.getByRole("banner")).toBeVisible({ timeout: 15_000 })
  await expect(page.locator("main")).toBeVisible({ timeout: 15_000 })
}

async function expectText(page: Page, text: string | RegExp, timeout = 5_000): Promise<void> {
  await expect(page.getByText(text).first()).toBeVisible({ timeout })
}

async function expectImageLoaded(page: Page, alt: string | RegExp): Promise<void> {
  const image = page.getByRole("img", { name: alt }).first()
  await expect(image).toBeVisible({ timeout: 10_000 })
  const imageSrc = await image.getAttribute("src")
  expect(imageSrc).toBeTruthy()
  await expectImageResponse(page, imageSrc!)
  await expect.poll(async () => await image.evaluate((node) => (node as HTMLImageElement).naturalWidth), {
    timeout: 10_000,
  }).toBeGreaterThan(0)
}

async function expectImageResponse(page: Page, imageSrc: string): Promise<void> {
  const response = await page.request.get(imageSrc)
  expect(response.ok()).toBe(true)
  expect(response.headers()["content-type"]).toMatch(/^image\//)
  expect((await response.body()).length).toBeGreaterThan(0)
}

async function clickButton(page: Page, name: RegExp): Promise<void> {
  const button = page.getByRole("button", { name }).first()
  await expect(button).toBeEnabled({ timeout: 15_000 })
  await button.click()
}

async function seedNode(
  backend: Awaited<ReturnType<typeof startBackend>>,
  nodeId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const now = Date.now()
  const snapshot = {
    workspaces: [{ id: WORKSPACE_ID, label: "Default", createdAt: now, updatedAt: now }],
    lanes: [],
    components: [{
      id: `comp-${nodeId}-real-click`,
      moduleId: nodeId,
      workspaceId: WORKSPACE_ID,
      data,
      flowPosition: { x: 80, y: 80 },
      flowSize: { width: 384, height: 320 },
      createdAt: now,
      updatedAt: now,
    }],
  }
  const response = await fetch(new URL("/workspace/snapshot", backend.url), {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      "x-xiranite-token": backend.token,
    },
    body: JSON.stringify(snapshot),
  })
  expect(response.ok).toBe(true)
}

async function createFixture(label: string): Promise<string> {
  const dir = path.join(RUN_ROOT, `${label}-${randomUUID()}`)
  await mkdir(dir, { recursive: true })
  return dir
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

async function createCDriveRecycleBinFixture(): Promise<string> {
  const dir = path.join("C:\\Users\\30902\\AppData\\Local\\Temp\\xiranite-recycleu-e2e", randomUUID())
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, "recycleu-real-click.txt")
  await writeFile(file, "xiranite recycleu real click test", "utf8")
  runPowerShell(`
    Add-Type -AssemblyName Microsoft.VisualBasic;
    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(
      ${quotePowerShell(file)},
      [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
      [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin
    )
  `)
  return file
}

function recycleCounts(): Record<string, number> {
  const raw = runPowerShell(`
    $shell = New-Object -ComObject Shell.Application;
    $rb = $shell.Namespace(10);
    $counts = @{};
    foreach ($item in @($rb.Items())) {
      $orig = $rb.GetDetailsOf($item, 1);
      if (-not $orig) { $orig = $item.Path }
      $drive = if ($orig -match '^([A-Za-z]):') { $matches[1].ToUpperInvariant() } else { '<unknown>' };
      if (-not $counts.ContainsKey($drive)) { $counts[$drive] = 0 }
      $counts[$drive]++
    }
    $counts | ConvertTo-Json -Compress
  `)
  return raw ? JSON.parse(raw) as Record<string, number> : {}
}

function runPowerShell(script: string): string {
  const wrapped = `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); ${script}`
  return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", wrapped], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim()
}

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function normalizeFsPath(value: string): string {
  return path.resolve(value).replace(/\\/g, "/")
}

function sampleOwithuToml(): string {
  return `
[defaults]
enabled = true
hives = ["HKCU"]

[vars]
scoop_root = "D:/scoop"

[[entries]]
key = "VSCode"
label = "Open with Code"
exe = "{scoop_root}/apps/vscode/current/Code.exe"
scope = ["file", "directory", "background"]
args = ["%1"]
`
}
