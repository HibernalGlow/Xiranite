import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { page } from "vitest/browser"
import { cleanup, render } from "vitest-browser-react"

import { useWorkspaceStore } from "@/store/workspaceStore"

const runtime = vi.hoisted(() => ({ callByName: vi.fn() }))
const backend = vi.hoisted(() => ({
  getAppConfig: vi.fn(),
  getThemes: vi.fn(),
  getBackground: vi.fn(),
  saveAppConfig: vi.fn(async () => undefined),
  saveThemes: vi.fn(async () => undefined),
  saveBackground: vi.fn(async () => undefined),
}))
const theme = vi.hoisted(() => ({
  theme: "dark" as "light" | "dark" | "system",
  setTheme: vi.fn(),
}))

vi.mock("@wailsio/runtime", () => ({ Call: { ByName: runtime.callByName } }))
vi.mock("@/hooks/useLocalBackendStatus", () => ({
  useLocalBackendStatus: () => ({
    data: { status: "ready", config: { baseUrl: "http://wails.localhost/_xiranite/backend", token: "direct-token" } },
  }),
}))
vi.mock("@/backend/configRpcClient", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/backend/configRpcClient")>(),
  getAppConfigFromBackend: backend.getAppConfig,
  getCustomThemesFromBackend: backend.getThemes,
  getBackgroundImageFromBackend: backend.getBackground,
  saveAppConfigToBackend: backend.saveAppConfig,
  saveCustomThemesToBackend: backend.saveThemes,
  saveBackgroundImageToBackend: backend.saveBackground,
}))
vi.mock("@/components/use-theme", () => ({ useTheme: () => theme }))
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}))

import { DirectNodeHostShell } from "./DirectNodeHostShell"

beforeEach(() => {
  Object.assign(window, { _wails: {} })
  runtime.callByName.mockReset().mockResolvedValue({ success: true, supported: true, state: "normal" })
  backend.getAppConfig.mockReset().mockResolvedValue({ config: { version: 3 }, path: "D:/data/xiranite.config.toml" })
  backend.getThemes.mockReset().mockResolvedValue({ themes: [], path: "D:/data/themes.json" })
  backend.getBackground.mockReset().mockResolvedValue({ url: null, path: "D:/data/xiranite.config.toml" })
  backend.saveAppConfig.mockClear()
  backend.saveThemes.mockClear()
  backend.saveBackground.mockClear()
  theme.theme = "dark"
  theme.setTheme.mockClear()
})

afterEach(() => {
  cleanup()
  delete window._wails
  window.localStorage.clear()
  useWorkspaceStore.getState().setCustomThemes([])
  useWorkspaceStore.getState().setTheme("spatial")
  document.documentElement.removeAttribute("style")
  for (const attribute of [...document.documentElement.attributes]) {
    if (attribute.name.startsWith("data-")) document.documentElement.removeAttribute(attribute.name)
  }
})

test("[external-node-host.chrome.gui] exposes a drag region and all native caption controls", async () => {
  await render(<DirectNodeHostShell nodeId="neoview"><div>NeoView</div></DirectNodeHostShell>)

  const dragRegion = page.getByTestId("direct-node-host-drag-region")
  await expect.element(dragRegion).toBeVisible()
  const actions = ["minimize", "maximize", "close"] as const
  for (const action of actions) {
    const button = document.querySelector<HTMLElement>(`[data-window-control-action="${action}"]`)
    expect(button).not.toBeNull()
    await page.elementLocator(button!).click()
  }

  await expect.poll(() => runtime.callByName.mock.calls).toEqual([
    ["main.XiraniteService.NodeAppWindowControl", "minimize"],
    ["main.XiraniteService.NodeAppWindowControl", "maximize"],
    ["main.XiraniteService.NodeAppWindowControl", "close"],
  ])

  await dragRegion.dblClick()
  await expect.poll(() => runtime.callByName).toHaveBeenLastCalledWith(
    "main.XiraniteService.NodeAppWindowControl",
    "maximize",
  )
})

test("[external-node-host.chrome-failure.gui] contains native control failures", async () => {
  runtime.callByName.mockRejectedValueOnce(new Error("window controller unavailable"))
  await render(<DirectNodeHostShell nodeId="neoview"><div>NeoView</div></DirectNodeHostShell>)

  const minimize = document.querySelector<HTMLButtonElement>('[data-window-control-action="minimize"]')
  expect(minimize).not.toBeNull()
  await page.elementLocator(minimize!).click()

  await expect.poll(() => minimize!.disabled).toBe(false)
  expect(runtime.callByName).toHaveBeenCalledOnce()
})

test("[external-node-host.appearance.gui] hydrates shared app UI and custom theme settings", async () => {
  backend.getAppConfig.mockResolvedValue({
    path: "D:/data/xiranite.config.toml",
    config: {
      version: 3,
      workspace: {
        theme: "spatial",
        themeSelections: {
          light: { kind: "preset", name: "wuling" },
          dark: { kind: "custom", name: "Direct host theme" },
        },
        floatingWindowCaptionPosition: "left",
        floatingWindowCaptionStyle: "traffic-light",
        floatingWindowCaptionAutoCollapse: false,
      },
      appearance: { colorMode: "dark" },
    },
  })
  backend.getThemes.mockResolvedValue({
    path: "D:/data/themes.json",
    themes: [{
      name: "Direct host theme",
      cssVars: {
        light: { primary: "oklch(0.5 0.1 120)" },
        dark: { primary: "oklch(0.72 0.12 250)" },
      },
    }],
  })

  await render(<DirectNodeHostShell nodeId="sample-node"><div>Direct node</div></DirectNodeHostShell>)

  await expect.poll(() => document.documentElement.dataset.customThemeName).toBe("Direct host theme")
  expect(document.documentElement.style.getPropertyValue("--primary")).toBe("oklch(0.72 0.12 250)")
  await expect.poll(() => document.querySelector("[data-direct-node-host]")?.getAttribute("data-floating-window-caption-style")).toBe("traffic-light")
  expect(backend.getAppConfig).toHaveBeenCalledWith("ui")
  expect(backend.getThemes).toHaveBeenCalledOnce()
  expect(backend.getBackground).toHaveBeenCalledOnce()
})
