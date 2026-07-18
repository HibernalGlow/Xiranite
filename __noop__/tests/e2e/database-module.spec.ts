import { test, expect, type Page } from "@playwright/test"
import { createMemoryWorkspaceRepository } from "@xiranite/repository"
import type { WorkspaceSnapshotDTO } from "@xiranite/shared"
import { startBackend } from "../../packages/backend/src/index"

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "Database rendering is verified once on the desktop viewport")
})

test("database module lazy-loads ocean styles and renders workspace rows", async ({ page }) => {
  const backend = await startBackend({ token: "database-module-e2e-token", repository: createMemoryWorkspaceRepository() })
  try {
    await seedDatabaseWorkspace(backend)
    await openApp(page, backend)

    await expect(page.getByRole("button", { name: "Table" })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText("Module", { exact: true })).toBeVisible()
    await expect(page.getByText("Category", { exact: true })).toBeVisible()
    await expect(page.getByText("SCRATCH", { exact: true })).toBeVisible()
    await expect(page.getByText("comp-database-e2e-scratch-1700000000100")).toBeVisible()
    await expect(page.getByText("database-e2e-tag", { exact: true })).toBeVisible()

    await page.getByRole("button", { name: "List" }).click()
    await expect(page.getByText("comp-database-e2e-scratch-1700000000100")).toBeVisible()
  } finally {
    backend.close()
  }
})

async function openApp(
  page: Page,
  backend: Awaited<ReturnType<typeof startBackend>>,
): Promise<void> {
  await page.addInitScript((config) => {
    ;(window as typeof window & { __XIRANITE_BACKEND__?: unknown }).__XIRANITE_BACKEND__ = config
  }, { baseUrl: backend.url, token: backend.token })
  await page.goto("/", { waitUntil: "domcontentloaded" })
  await expect(page.getByRole("banner")).toBeVisible({ timeout: 15_000 })
  await expect(page.locator("main")).toBeVisible({ timeout: 15_000 })
}

async function seedDatabaseWorkspace(backend: Awaited<ReturnType<typeof startBackend>>): Promise<void> {
  const now = Date.now()
  const snapshot: WorkspaceSnapshotDTO = {
    workspaces: [
      { id: "ws-database-e2e", label: "Database E2E", createdAt: now, updatedAt: now },
    ],
    lanes: [],
    components: [
      {
        id: "comp-database-e2e-shell-1700000000000",
        moduleId: "database",
        workspaceId: "ws-database-e2e",
        data: {},
        flowPosition: { x: 80, y: 80 },
        flowSize: { width: 760, height: 520 },
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "comp-database-e2e-scratch-1700000000100",
        moduleId: "scratch",
        workspaceId: "ws-database-e2e",
        data: { text: "database row source" },
        hiddenIn: { cards: true },
        tags: ["database-e2e-tag"],
        flowPosition: { x: 220, y: 120 },
        flowSize: { width: 384, height: 320 },
        createdAt: now,
        updatedAt: now,
      },
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
