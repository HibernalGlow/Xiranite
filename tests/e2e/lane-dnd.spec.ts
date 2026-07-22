import { test, expect, type Locator, type Page } from "@playwright/test"
import { createMemoryWorkspaceRepository } from "@xiranite/repository"
import type { WorkspaceSnapshotDTO } from "@xiranite/shared"
import { startBackend } from "../../packages/backend/src/index"

const WORKSPACE_ID = "ws-lane-dnd"

test.describe.configure({ mode: "serial" })

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "lane DnD is verified once on the desktop viewport")
})

test("lane view moves cards across lanes and reorders lanes with dnd-kit", async ({ page }) => {
  test.setTimeout(90_000)
  const backend = await startBackend({ token: "lane-dnd-test-token", repository: createMemoryWorkspaceRepository() })
  try {
    await seedLaneWorkspace(backend)
    await openApp(page, backend)
    await page.locator('[data-view-mode="lane"]').click()

    const leftCard = page.locator('[data-card-id="comp-alpha"]')
    const rightLane = page.locator('[data-lane-id="lane-right"]')
    await expect(page.locator('[data-lane-id="lane-left"] [data-card-id="comp-alpha"]')).toBeVisible()
    await expect(rightLane.locator('[data-card-id="comp-alpha"]')).toHaveCount(0)

    await dragTo(page, leftCard.locator('[data-lane-card-drag-handle="true"]'), rightLane.locator('[data-lane-drop-zone="lane-right"]'))

    await expect(rightLane.locator('[data-card-id="comp-alpha"]')).toBeVisible({ timeout: 10_000 })
    await expect.poll(async () => {
      const snapshot = await readSnapshot(backend)
      return snapshot.components.find((component) => component.id === "comp-alpha")?.laneId
    }, { timeout: 10_000 }).toBe("lane-right")

    await dragTo(
      page,
      page.locator('[data-lane-id="lane-left"] [data-lane-drag-handle="true"]'),
      page.locator('[data-lane-id="lane-right"] [data-lane-drag-handle="true"]'),
    )

    await expect.poll(async () => page.locator("[data-lane-id]").evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-lane-id")).filter(Boolean),
    ), { timeout: 10_000 }).toEqual(["lane-right", "lane-left"])
    await expect.poll(async () => {
      const snapshot = await readSnapshot(backend)
      return snapshot.lanes.map((lane) => lane.id)
    }, { timeout: 10_000 }).toEqual(["lane-right", "lane-left"])
  } finally {
    backend.close()
  }
})

async function openApp(page: Page, backend: Awaited<ReturnType<typeof startBackend>>): Promise<void> {
  await page.addInitScript((config) => {
    ;(window as typeof window & { __XIRANITE_BACKEND__?: unknown }).__XIRANITE_BACKEND__ = config
  }, { baseUrl: backend.url, token: backend.token })
  await page.goto("/", { waitUntil: "commit" })
  await expect(page.getByRole("banner")).toBeVisible({ timeout: 45_000 })
  await expect(page.locator("main")).toBeVisible({ timeout: 45_000 })
}

async function seedLaneWorkspace(backend: Awaited<ReturnType<typeof startBackend>>): Promise<void> {
  const now = Date.now()
  const snapshot: WorkspaceSnapshotDTO = {
    workspaces: [{ id: WORKSPACE_ID, label: "Lane DnD", createdAt: now, updatedAt: now }],
    lanes: [
      { id: "lane-left", label: "Left", workspaceId: WORKSPACE_ID, widthRatio: 1, collapsed: false, cardOrder: ["comp-alpha"], createdAt: now, updatedAt: now },
      { id: "lane-right", label: "Right", workspaceId: WORKSPACE_ID, widthRatio: 1, collapsed: false, cardOrder: ["comp-beta"], createdAt: now, updatedAt: now },
    ],
    components: [
      { id: "comp-alpha", moduleId: "scratch", workspaceId: WORKSPACE_ID, laneId: "lane-left", createdAt: now, updatedAt: now },
      { id: "comp-beta", moduleId: "counter", workspaceId: WORKSPACE_ID, laneId: "lane-right", createdAt: now, updatedAt: now },
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

async function readSnapshot(backend: Awaited<ReturnType<typeof startBackend>>): Promise<WorkspaceSnapshotDTO> {
  const response = await fetch(new URL("/workspace/snapshot", backend.url), {
    headers: { "x-xiranite-token": backend.token },
  })
  expect(response.ok).toBe(true)
  const body = await response.json() as { snapshot: WorkspaceSnapshotDTO }
  return body.snapshot
}

async function dragTo(page: Page, source: Locator, target: Locator): Promise<void> {
  await expect(source).toBeVisible({ timeout: 10_000 })
  await expect(target).toBeVisible({ timeout: 10_000 })
  const sourceBox = await source.boundingBox()
  const targetBox = await target.boundingBox()
  if (!sourceBox || !targetBox) throw new Error("Unable to resolve drag target boxes.")

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + Math.min(targetBox.height / 2, 80), { steps: 16 })
  await page.mouse.up()
}
