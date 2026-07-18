import { test, expect, type Locator, type Page } from "@playwright/test"
import { createMemoryWorkspaceRepository } from "@xiranite/repository"
import type { WorkspaceSnapshotDTO } from "@xiranite/shared"
import { startBackend } from "../../packages/backend/src/index"

const WORKSPACE_ID = "ws-kanban-dnd"

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "kanban DnD is verified once on the desktop viewport")
})

test("kanban module moves a card across columns with dnd-kit", async ({ page }) => {
  const backend = await startBackend({ token: "kanban-dnd-test-token", repository: createMemoryWorkspaceRepository() })
  try {
    await seedKanbanWorkspace(backend)
    await openApp(page, backend)

    const backlogCards = page.locator('[data-kanban-column="backlog"] [data-kanban-card]')
    const activeColumn = page.locator('[data-kanban-column="active"]')
    await expect(backlogCards).toHaveCount(2)
    await expect(activeColumn.locator("[data-kanban-card]")).toHaveCount(1)

    const firstBacklogCard = backlogCards.first()
    const cardId = await firstBacklogCard.getAttribute("data-kanban-card")
    expect(cardId).toBeTruthy()

    await dragTo(page, firstBacklogCard.locator('[data-kanban-card-drag-handle="true"]'), activeColumn)

    await expect(page.locator(`[data-kanban-column="active"] [data-kanban-card="${cardId}"]`)).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('[data-kanban-column="backlog"] [data-kanban-card]')).toHaveCount(1)
    await expect(page.locator('[data-kanban-column="active"] [data-kanban-card]')).toHaveCount(2)
  } finally {
    backend.close()
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

async function seedKanbanWorkspace(backend: Awaited<ReturnType<typeof startBackend>>): Promise<void> {
  const now = Date.now()
  const snapshot: WorkspaceSnapshotDTO = {
    workspaces: [{ id: WORKSPACE_ID, label: "Kanban DnD", createdAt: now, updatedAt: now }],
    lanes: [],
    components: [{
      id: "comp-kanban-dnd",
      moduleId: "kanban",
      workspaceId: WORKSPACE_ID,
      flowPosition: { x: 80, y: 80 },
      flowSize: { width: 520, height: 320 },
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

async function dragTo(page: Page, source: Locator, target: Locator): Promise<void> {
  await expect(source).toBeVisible({ timeout: 10_000 })
  await expect(target).toBeVisible({ timeout: 10_000 })
  const sourceBox = await source.boundingBox()
  const targetBox = await target.boundingBox()
  if (!sourceBox || !targetBox) throw new Error("Unable to resolve drag target boxes.")

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + Math.min(targetBox.height / 2, 120), { steps: 16 })
  await page.mouse.up()
}
