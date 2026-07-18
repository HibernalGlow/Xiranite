import { test, expect, type Page } from "@playwright/test"
import { createMemoryWorkspaceRepository } from "@xiranite/repository"
import type { WorkspaceSnapshotDTO } from "@xiranite/shared"
import { startBackend } from "../../packages/backend/src/index"

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "Flow view chunking is verified once on the desktop viewport")
})

test("empty flow view renders without loading the tldraw canvas chunk", async ({ page }) => {
  const backend = await startBackend({ token: "flow-empty-e2e-token", repository: createMemoryWorkspaceRepository() })
  const requestedUrls: string[] = []
  page.on("request", (request) => requestedUrls.push(request.url()))

  try {
    await seedFlowWorkspace(backend, [])
    await openApp(page, backend, "/?view=flow&workspace=ws-flow-e2e")

    await expect(page.getByRole("button", { name: /打开模块库|OPEN MODULE REGISTRY/i })).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(500)
    expect(requestedUrls.some((url) => url.includes("FlowCanvasView"))).toBe(false)
  } finally {
    backend.close()
  }
})

test("flow view lazy-loads the canvas only when a flow-visible component exists", async ({ page }) => {
  const backend = await startBackend({ token: "flow-canvas-e2e-token", repository: createMemoryWorkspaceRepository() })
  const requestedUrls: string[] = []
  page.on("request", (request) => requestedUrls.push(request.url()))

  try {
    await seedFlowWorkspace(backend, [
      {
        id: "comp-flow-e2e-scratch",
        moduleId: "scratch",
        workspaceId: "ws-flow-e2e",
        data: {},
        hiddenIn: { flow: false },
        flowPosition: { x: 80, y: 80 },
        flowSize: { width: 384, height: 320 },
        createdAt: 1_700_000_000_100,
        updatedAt: 1_700_000_000_100,
      },
    ])
    await openApp(page, backend, "/?view=flow&workspace=ws-flow-e2e")

    await expect(page.getByText("SCRATCH", { exact: true })).toBeVisible({ timeout: 25_000 })
    await expect(page.getByPlaceholder(/临时缓冲|ephemeral buffer/i)).toBeVisible()
    expect(requestedUrls.some((url) => url.includes("FlowCanvasView"))).toBe(true)
  } finally {
    backend.close()
  }
})

async function openApp(
  page: Page,
  backend: Awaited<ReturnType<typeof startBackend>>,
  url: string,
): Promise<void> {
  await page.addInitScript((config) => {
    ;(window as typeof window & { __XIRANITE_BACKEND__?: unknown }).__XIRANITE_BACKEND__ = config
  }, { baseUrl: backend.url, token: backend.token })
  await page.goto(url, { waitUntil: "domcontentloaded" })
  await expect(page.getByRole("banner")).toBeVisible({ timeout: 15_000 })
  await expect(page.locator("main")).toBeVisible({ timeout: 15_000 })
}

async function seedFlowWorkspace(
  backend: Awaited<ReturnType<typeof startBackend>>,
  components: WorkspaceSnapshotDTO["components"],
): Promise<void> {
  const now = Date.now()
  const snapshot: WorkspaceSnapshotDTO = {
    workspaces: [
      { id: "ws-flow-e2e", label: "Flow E2E", createdAt: now, updatedAt: now },
    ],
    lanes: [],
    components,
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
