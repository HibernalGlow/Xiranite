import { afterEach, expect, test, vi } from "vitest"
import { page } from "vitest/browser"
import { cleanup, render } from "vitest-browser-react"

import i18n from "@/i18n"
import { MODULE_REGISTRY } from "@/components/modules/registry"

const deployComponent = vi.hoisted(() => vi.fn())

vi.mock("@/store/workspaceStore", async () => {
  const actions = { deployComponent }
  return {
    useWorkspaceSelector: (selector: (state: { viewMode: string }) => unknown) => selector({ viewMode: "grid" }),
    useWorkspaceActions: () => actions,
  }
})

const { ModuleRegistry: Registry } = await import("./ModuleRegistry")

function rowCount(): number {
  return document.querySelectorAll("tr[data-row-id]").length
}

afterEach(() => {
  cleanup()
  deployComponent.mockClear()
})

test("module catalog searches, resets, deploys on row click and filters by category", async () => {
  await i18n.changeLanguage("en")
  await render(
    <div className="h-[720px] w-[440px] overflow-hidden border">
      <Registry />
    </div>,
  )

  const total = MODULE_REGISTRY.length
  // The gauge must see every row before "fewer rows" means anything.
  await expect.poll(rowCount).toBe(total)

  const search = page.getByPlaceholder("SEARCH_MODULES...")
  await search.fill("scratch")
  await expect.poll(rowCount).toBe(1)
  const scratchRow = page.getByText("SCRATCH", { exact: true })
  await expect.element(scratchRow).toBeVisible()
  await scratchRow.click()
  expect(deployComponent).toHaveBeenCalledWith("scratch", "grid")
  const dragSource = document.querySelector<HTMLElement>("[data-module-id='scratch']")
  expect(dragSource?.getAttribute("draggable")).toBe("true")

  await search.fill("no-such-module-xyz")
  await expect.poll(rowCount).toBe(0)
  await page.getByRole("button", { name: "Reset" }).click()
  await expect.poll(rowCount).toBe(total)

  // Left open on purpose: with a selection the trigger's accessible name gains the count badge.
  await page.getByRole("button", { name: "FILTER", exact: true }).click()
  await page.getByRole("option", { name: "UTILITY", exact: true }).click()
  await expect.poll(rowCount).toBe(MODULE_REGISTRY.filter((module) => module.category === "UTILITY").length)
})
