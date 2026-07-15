import { test, expect, type Page } from "@playwright/test"
import { createMemoryWorkspaceRepository } from "@xiranite/repository"
import type { WorkspaceSnapshotDTO } from "@xiranite/shared"
import { startBackend } from "../../packages/backend/src/index"

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "URL state is verified once on the desktop viewport")
})

test("workspace view and active workspace sync through nuqs URL params", async ({ page }) => {
  const backend = await startBackend({ token: "url-state-test-token", repository: createMemoryWorkspaceRepository() })
  try {
    await seedUrlWorkspace(backend)
    await openApp(page, backend, "/?view=lane&workspace=ws-url-b")

    await expect(page.locator('[data-lane-id="lane-url-b"]')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('[data-active-workspace-id="ws-url-b"]')).toBeVisible()
    await expect.poll(() => new URL(page.url()).searchParams.get("view")).toBe("lane")
    await expect.poll(() => new URL(page.url()).searchParams.get("workspace")).toBe("ws-url-b")

    await page.locator('button[data-view-mode="flow"]').click()
    await expect.poll(() => new URL(page.url()).searchParams.get("view")).toBe("flow")

    await page.locator('button[data-view-mode="cards"]').click()
    await expect.poll(() => new URL(page.url()).searchParams.get("view")).toBe("cards")

    await page.locator('[data-active-workspace-id="ws-url-b"]').click()
    await page.locator('button[data-workspace-id="ws-url-a"]').click()
    await expect(page.locator('[data-active-workspace-id="ws-url-a"]')).toBeVisible()
    await expect.poll(() => new URL(page.url()).searchParams.get("workspace")).toBe("ws-url-a")
  } finally {
    backend.close()
  }
})

test("floating component query params still render a popup window", async ({ page }) => {
  const backend = await startBackend({ token: "url-state-popup-token", repository: createMemoryWorkspaceRepository() })
  try {
    await seedUrlWorkspace(backend)
    await openApp(
      page,
      backend,
      "/?floatingComponent=comp-popup-xlchemy&moduleId=xlchemy&windowId=popup-url-state&title=Popup%20Smoke",
    )

    await expect(page.locator(".xiranite-floating-window")).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText("Popup Smoke")).toHaveCount(0)
    await expect(page.locator("main")).toBeVisible()

    await expect(page.getByTestId("floating-window-titlebar")).toHaveCount(0)
    const nodeTitlebar = page.getByTestId("xlchemy-header")
    await expect(nodeTitlebar).toHaveAttribute("data-floating-window-titlebar", "true")
    await expect(page.getByTestId("floating-window-fallback-controls")).toHaveCount(0)
    const captionControls = page.getByTestId("floating-window-integrated-controls")
    await expect(captionControls.getByRole("button")).toHaveCount(3)
    await expect.poll(async () => {
      const titlebarBox = await nodeTitlebar.boundingBox()
      const controlsBox = await captionControls.boundingBox()
      if (!controlsBox || !titlebarBox) return false
      return Math.abs(controlsBox.y - titlebarBox.y) <= 1
        && Math.abs((controlsBox.y + controlsBox.height) - (titlebarBox.y + titlebarBox.height)) <= 1
        && Math.abs((controlsBox.x + controlsBox.width) - (titlebarBox.x + titlebarBox.width)) <= 1
    }).toBe(true)
  } finally {
    backend.close()
  }
})

async function openApp(
  page: Page,
  backend: Awaited<ReturnType<typeof startBackend>>,
  url = "/",
): Promise<void> {
  await page.addInitScript((config) => {
    ;(window as typeof window & { __XIRANITE_BACKEND__?: unknown }).__XIRANITE_BACKEND__ = config
  }, { baseUrl: backend.url, token: backend.token })
  await page.goto(url, { waitUntil: "domcontentloaded" })
  if (url.includes("floatingComponent=")) {
    await expect(page.locator(".xiranite-floating-window")).toBeVisible({ timeout: 15_000 })
  } else {
    await expect(page.getByRole("banner")).toBeVisible({ timeout: 15_000 })
  }
  await expect(page.locator("main")).toBeVisible({ timeout: 15_000 })
}

async function seedUrlWorkspace(backend: Awaited<ReturnType<typeof startBackend>>): Promise<void> {
  const now = Date.now()
  const snapshot: WorkspaceSnapshotDTO = {
    workspaces: [
      { id: "ws-url-a", label: "Workspace A", createdAt: now, updatedAt: now },
      { id: "ws-url-b", label: "Workspace B", createdAt: now, updatedAt: now },
    ],
    lanes: [
      { id: "lane-url-b", label: "URL Lane", workspaceId: "ws-url-b", widthRatio: 1, collapsed: false, cardOrder: ["comp-url-b"], createdAt: now, updatedAt: now },
    ],
    components: [
      { id: "comp-url-b", moduleId: "scratch", workspaceId: "ws-url-b", laneId: "lane-url-b", createdAt: now, updatedAt: now },
      { id: "comp-popup-xlchemy", moduleId: "xlchemy", workspaceId: "ws-url-a", createdAt: now, updatedAt: now },
    ],
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
