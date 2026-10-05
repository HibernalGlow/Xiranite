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
      "/?floatingComponent=comp-popup-samea&moduleId=samea&windowId=popup-url-state&title=Popup%20Smoke",
    )

    await expect(page.locator(".xiranite-floating-window")).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText("Popup Smoke")).toHaveCount(0)
    await expect(page.locator("main")).toBeVisible()

    await expect(page.getByTestId("floating-window-titlebar")).toHaveCount(0)
    const nodeTitlebar = page.locator('.xiranite-floating-window header[data-floating-window-titlebar="true"]')
    await expect(nodeTitlebar).toBeVisible()
    const dragRegion = page.locator(".xiranite-floating-window .xiranite-app-region-drag").first()
    await expect.poll(() => dragRegion.evaluate((element) => {
      const style = getComputedStyle(element)
      return style.getPropertyValue("--wails-draggable").trim() === "drag"
        && element.getBoundingClientRect().width >= 100
    })).toBe(true)
    await expect(page.getByTestId("floating-window-fallback-controls")).toHaveCount(0)
    const captionControls = page.getByTestId("floating-window-integrated-controls")
    await expect(captionControls.getByRole("button")).toHaveCount(3)
    await expect(captionControls.getByRole("button").nth(1).locator("svg rect")).toHaveCount(1)
    await expect.poll(() => captionControls.getByRole("button").evaluateAll((buttons) => buttons.every((button) => {
      const style = getComputedStyle(button)
      return style.borderRadius === "0px" && style.borderWidth === "0px" && style.boxShadow === "none"
    }))).toBe(true)
    await expect.poll(async () => {
      const titlebarBox = await nodeTitlebar.boundingBox()
      const controlsBox = await captionControls.boundingBox()
      if (!controlsBox || !titlebarBox) return false
      return Math.abs(controlsBox.y - titlebarBox.y) <= 1
        && Math.abs((controlsBox.y + controlsBox.height) - (titlebarBox.y + titlebarBox.height)) <= 1
        && Math.abs((controlsBox.x + controlsBox.width) - (titlebarBox.x + titlebarBox.width)) <= 1
    }).toBe(true)

    await openApp(page, backend, "/?floatingComponent=comp-popup-fallback&moduleId=scratch&windowId=popup-fallback")
    await expect(page.getByTestId("floating-window-fallback-controls").getByRole("button")).toHaveCount(3)
    await expect.poll(() => page.getByTestId("floating-window-fallback-drag-region").evaluate((element) => (
      getComputedStyle(element).getPropertyValue("--wails-draggable").trim()
    ))).toBe("drag")

    await openApp(page, backend, "/?floatingComponent=comp-popup-samea&moduleId=samea&windowId=popup-samea")
    const sameaTitlebar = page.locator('.xiranite-floating-window header[data-floating-window-titlebar="true"]')
    await expect(sameaTitlebar).toBeVisible()
    await expect(page.getByTestId("floating-window-fallback-controls")).toHaveCount(0)
    await expect(sameaTitlebar.getByTestId("floating-window-integrated-controls").getByRole("button")).toHaveCount(3)
    await expect.poll(() => page.locator(".xiranite-floating-window .xiranite-app-region-drag").first().evaluate((element) => (
      getComputedStyle(element).getPropertyValue("--wails-draggable").trim()
    ))).toBe("drag")
  } finally {
    backend.close()
  }
})

test("window-owned workspace components restore into popups instead of the main view", async ({ page }) => {
  const backend = await startBackend({ token: "window-restore-token", repository: createMemoryWorkspaceRepository() })
  try {
    const now = Date.now()
    await seedWorkspaceSnapshot(backend, {
      workspaces: [{ id: "ws-window-restore", label: "Window Restore", createdAt: now, updatedAt: now }],
      lanes: [],
      components: [{
        id: "comp-window-restore",
        moduleId: "scratch",
        workspaceId: "ws-window-restore",
        placement: "window",
        createdAt: now,
        updatedAt: now,
      }],
    })
    await page.addInitScript(() => {
      localStorage.setItem("xiranite-workspace-ui", JSON.stringify({
        state: { restoreWorkspaceComponents: true },
        version: 2,
      }))
    })

    const popupPromise = page.waitForEvent("popup")
    await openApp(page, backend)
    const popup = await popupPromise

    await expect.poll(() => new URL(popup.url()).searchParams.get("floatingComponent")).toBe("comp-window-restore")
    await expect(popup.locator(".xiranite-floating-window")).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('[data-component-id="comp-window-restore"]')).toHaveCount(0)
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
      { id: "comp-popup-samea", moduleId: "samea", workspaceId: "ws-url-a", createdAt: now, updatedAt: now },
    ],
  }
  await seedWorkspaceSnapshot(backend, snapshot)
}

async function seedWorkspaceSnapshot(
  backend: Awaited<ReturnType<typeof startBackend>>,
  snapshot: WorkspaceSnapshotDTO,
): Promise<void> {
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
