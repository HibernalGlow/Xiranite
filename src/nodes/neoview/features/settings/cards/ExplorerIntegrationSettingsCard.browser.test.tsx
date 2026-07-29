import { expect, test, vi } from "vitest"
import { page } from "vitest/browser"
import { render } from "vitest-browser-react"

import { ExplorerIntegrationSettingsCard } from "./ExplorerIntegrationSettingsCard"

test("[neoview.settings.explorer-integration] previews and confirms an opt-in before enabling the Explorer verb", async () => {
  const setEnabled = vi.fn(async (enabled: boolean) => ({ available: true, enabled, state: enabled ? "registered" as const : "disabled" as const }))
  await render(<ExplorerIntegrationSettingsCard actions={{
    preview: async () => ({ available: true, registryFile: "", plan: [{ entryKey: "Xiranite.NeoView.Open", hive: "HKCU", scope: "file", registryPath: "HKCU\\Software\\Classes\\SystemFileAssociations\\.cbz\\shell\\Xiranite.NeoView.Open", label: "Open with NeoView", icon: "Xiranite.exe", command: "Xiranite.exe --launch-node neoview", enabled: true }] }),
    status: async () => ({ available: true, enabled: false, state: "disabled" }),
    setEnabled,
    repair: vi.fn(),
  }} />)

  await page.getByRole("switch", { name: "使用 NeoView 打开" }).click()
  await expect.element(page.getByRole("alertdialog")).toBeVisible()
  await expect.element(page.getByText("HKCU\\Software\\Classes\\SystemFileAssociations\\.cbz\\shell\\Xiranite.NeoView.Open")).toBeVisible()
  expect(setEnabled).not.toHaveBeenCalled()

  await page.getByRole("button", { name: "确认启用" }).click()
  await expect.poll(() => setEnabled).toHaveBeenCalledWith(true)
  await expect.element(page.getByText("已注册并与当前格式配置一致。")).toBeVisible()
})

test("[neoview.settings.explorer-integration] exposes a repair action without treating an external conflict as owned", async () => {
  const repair = vi.fn(async () => ({ available: true, enabled: true, state: "registered" as const }))
  await render(<ExplorerIntegrationSettingsCard actions={{
    preview: async () => ({ available: true, registryFile: "", plan: [] }),
    status: async () => ({ available: true, enabled: false, state: "needs-repair", reason: "configured format changed" }),
    setEnabled: vi.fn(),
    repair,
  }} />)

  await expect.element(page.getByRole("button", { name: "修复资源管理器集成" })).toBeVisible()
  await page.getByRole("button", { name: "修复资源管理器集成" }).click()
  await expect.poll(() => repair).toHaveBeenCalledOnce()
})

test("[neoview.settings.explorer-integration] leaves a known broken legacy registration unchecked and migratable", async () => {
  const setEnabled = vi.fn(async (enabled: boolean) => ({ available: true, enabled, state: enabled ? "registered" as const : "disabled" as const }))
  await render(<ExplorerIntegrationSettingsCard actions={{
    preview: async () => ({ available: true, registryFile: "", plan: [] }),
    status: async () => ({
      available: true,
      enabled: false,
      state: "disabled",
      reason: "A broken legacy Owithu registration without a launch command will be replaced when Explorer integration is changed.",
    }),
    setEnabled,
    repair: vi.fn(),
  }} />)

  const toggle = page.getByRole("switch")
  await expect.element(toggle).toHaveAttribute("data-state", "unchecked")
  await expect.element(toggle).not.toBeDisabled()
  await expect.element(page.getByText("A broken legacy Owithu registration without a launch command will be replaced when Explorer integration is changed.")).toBeVisible()
  await toggle.click()
  const dialog = page.getByRole("alertdialog")
  await expect.element(dialog).toBeVisible()
  expect(setEnabled).not.toHaveBeenCalled()

  await dialog.getByRole("button").nth(1).click()
  await expect.poll(() => setEnabled).toHaveBeenCalledWith(true)
})

test("[neoview.settings.explorer-integration] keeps the registration state visible when a toggle operation fails", async () => {
  const setEnabled = vi.fn(async () => { throw new Error("registry access denied") })
  await render(<ExplorerIntegrationSettingsCard actions={{
    preview: async () => ({ available: true, registryFile: "", plan: [] }),
    status: async () => ({ available: true, enabled: true, state: "registered" }),
    setEnabled,
    repair: vi.fn(),
  }} />)

  const toggle = page.getByRole("switch")
  await expect.element(toggle).toHaveAttribute("data-state", "checked")
  await toggle.click()
  await expect.poll(() => setEnabled).toHaveBeenCalledWith(false)
  await expect.element(page.getByRole("alert")).toHaveTextContent("registry access denied")
  await expect.element(toggle).toHaveAttribute("data-state", "checked")
})
