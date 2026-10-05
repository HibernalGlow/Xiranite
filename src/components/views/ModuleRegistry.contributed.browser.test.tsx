// The row a plugin contributes, as the product renders it.
//
// Deliberately reads `tbody tr` and cell text instead of `tr[data-row-id]`: that attribute is not in
// `git show HEAD:src/components/views/ModuleRegistry.tsx` (it lives in another lane's in-flight diff),
// so a test anchored on it would reference something not yet committed. Text is what the user reads.
import { afterEach, expect, test, vi } from "vitest"
import { page } from "vitest/browser"
import { cleanup, render } from "vitest-browser-react"

import i18n from "@/i18n"
import { MODULE_REGISTRY } from "@/components/modules/registry"
import { registerModuleContributions, resetModuleContributions } from "@/plugins/contributions"

const deployComponent = vi.hoisted(() => vi.fn())

vi.mock("@/store/workspaceStore", async () => {
  const actions = { deployComponent }
  return {
    useWorkspaceSelector: (selector: (state: { viewMode: string }) => unknown) => selector({ viewMode: "grid" }),
    useWorkspaceActions: () => actions,
  }
})

const { ModuleRegistry: Registry } = await import("./ModuleRegistry")

function rows(): string[] {
  return [...document.querySelectorAll("tbody tr")].map((row) => (row.textContent || "").replace(/\s+/g, " ").trim())
}

function rowFor(text: string): string | undefined {
  return rows().find((row) => row.includes(text))
}

afterEach(() => {
  cleanup()
  resetModuleContributions()
  deployComponent.mockClear()
})

test("a contributed row is listed under the name the plugin declared, at the plugin's version", async () => {
  await i18n.changeLanguage("en")

  // `7.7.7` is not any built-in's version, so "the row carries 7.7.7" can only come from the plugin.
  registerModuleContributions(
    "com.example.row",
    [
      { kind: "component", id: "row.named", name: "Named Panel", module: "./Named" },
      { kind: "component", id: "row.bare", module: "./Bare" },
    ],
    "7.7.7",
  )

  await render(
    <div className="h-[720px] w-[440px] overflow-hidden border">
      <Registry />
    </div>,
  )

  await expect.poll(() => rows().length).toBe(MODULE_REGISTRY.length + 2)

  const named = rowFor("Named Panel")
  expect(named).toBeDefined()
  // The id stays visible underneath the name — the row has to remain addressable by what the manifest
  // spells, not just by its label.
  expect(named).toContain("row.named")
  expect(named).toContain("7.7.7")

  // A row that declares no name is listed by its id (the fallback), and still inherits the version.
  const bare = rowFor("row.bare")
  expect(bare).toBeDefined()
  expect(bare).toContain("7.7.7")

  await page.getByPlaceholder("SEARCH_MODULES...").fill("Named Panel")
  await expect.poll(() => rows().length).toBe(1)
})
