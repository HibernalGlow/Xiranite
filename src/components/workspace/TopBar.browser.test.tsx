import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ThemeProvider } from "next-themes"
import { useState } from "react"
import { afterEach, expect, test, vi } from "vitest"
import { cleanup, render } from "vitest-browser-react"
import { page } from "vitest/browser"
import { TopBar } from "./TopBar"
import { WorkspaceAppearance } from "@/components/workspace/WorkspaceAppearance"
import { DEFAULT_DESIGN_THEME } from "@/lib/design-theme/contract"
import { DESIGN_THEME_ENTRIES } from "@/lib/design-theme/registry"
import { useWorkspaceStore } from "@/store/workspaceStore"

const runtime = vi.hoisted(() => ({
  openDevTools: vi.fn(async () => ({ success: true, supported: true, message: "Developer tools opened." })),
}))

const windowControls = vi.hoisted(() => ({
  capabilities: undefined as TopBarCaptionCapabilities | undefined,
}))

type TopBarCaptionCapabilities = {
  supported: boolean
  nativeWindowControls: boolean
  frameless: boolean
  captionOwner: "system" | "renderer"
  captionInset?: { x: number; y: number }
  componentWindows: "native"
}

/** The host answers control commands in both modes; only who paints the buttons differs. */
vi.mock("@/hooks/useWindowControls", () => ({
  useWindowControls: () => ({
    capabilities: windowControls.capabilities,
    capabilitiesPending: false,
    controlMain: vi.fn(async () => ({ success: true, supported: true, message: "Window controlled." })),
    controlMainPending: false,
  }),
}))

const rendererCaption: TopBarCaptionCapabilities = {
  supported: true,
  nativeWindowControls: true,
  frameless: true,
  captionOwner: "renderer",
  componentWindows: "native",
}

const systemCaption: TopBarCaptionCapabilities = {
  ...rendererCaption,
  captionOwner: "system",
  captionInset: { x: 20, y: 17 },
}

/** `WindowControlIcon` draws exactly these three glyphs, so the count does not depend on translations. */
function appCaptionGlyphCount(): number {
  return document.querySelectorAll(".xiranite-topbar svg.lucide-minus, .xiranite-topbar svg.lucide-square, .xiranite-topbar svg.lucide-x").length
}


vi.mock("@/backend/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/backend/client")>()
  return {
    ...actual,
    getRuntime: vi.fn(async () => ({ kind: "tauri", windows: { openDevTools: runtime.openDevTools } })),
  }
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  windowControls.capabilities = undefined
})

test("draws its own caption cluster while the renderer owns the buttons", async () => {
  windowControls.capabilities = rendererCaption
  await render(<TopBarHarness />)

  const titlebar = document.querySelector<HTMLElement>(".xiranite-topbar")!
  expect(titlebar.dataset.topbarCaption).toBe("renderer")
  await expect.poll(appCaptionGlyphCount).toBe(3)
  expect(getComputedStyle(titlebar).paddingLeft).toBe("16px")
})

test("hands the caption to the OS and starts its content past the traffic lights", async () => {
  windowControls.capabilities = systemCaption
  await render(<TopBarHarness />)

  const titlebar = document.querySelector<HTMLElement>(".xiranite-topbar")!
  expect(titlebar.dataset.topbarCaption).toBe("system")
  await expect.poll(appCaptionGlyphCount).toBe(0)
  // The host reported x=20; 82px is that inset plus the two-pitch traffic-light group and its clearance.
  await expect.poll(() => getComputedStyle(titlebar).paddingLeft).toBe("82px")
})

test("keeps the theme palette tint off the titlebar shell", async () => {
  await render(<TopBarHarness />)

  const titlebar = document.querySelector<HTMLElement>(".xiranite-topbar")!
  expect(titlebar.style.backgroundColor).toBe("")
  expect(titlebar.dataset.titlebarPaletteSlot).toBeUndefined()
  expect(titlebar.classList.contains("bg-background")).toBe(true)
})

test("opens developer tools from the app title menu", async () => {
  await render(<TopBarHarness />)

  const appMenuTrigger = [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.includes("XIRANITE"))
  expect(appMenuTrigger).toBeDefined()
  appMenuTrigger!.click()

  await expect.poll(() => document.querySelector('[data-testid="app-menu"]')?.textContent ?? "").toContain("打开开发者工具")
  const openDevTools = [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.includes("打开开发者工具"))
  expect(openDevTools?.textContent).toContain("F12")
  openDevTools!.click()

  await expect.poll(() => runtime.openDevTools).toHaveBeenCalledTimes(1)
})

/**
 * 顶栏「主题」下拉里必须能看见并直接切设计语言。
 *
 * 回读走 `:root[data-app-design]`——那是 `applyDesignTheme` 唯一写下的事实，
 * 只断言 store 里换了 id 不算数（点下去什么都没发生是这条链上最容易出的错）。
 */
test("switches the design language straight from the theme popover", async () => {
  useWorkspaceStore.getState().setDesignTheme({ ...DEFAULT_DESIGN_THEME })
  await render(
    <>
      <WorkspaceAppearance />
      <TopBarHarness />
    </>,
  )

  const themeTrigger = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.getAttribute("aria-label") === "主题" || button.title === "主题",
  )
  expect(themeTrigger, "顶栏没有「主题」入口").toBeDefined()
  themeTrigger!.click()

  await expect
    .poll(() => document.querySelectorAll("[data-design-theme-choice]").length)
    .toBe(DESIGN_THEME_ENTRIES.length)

  const md3 = document.querySelector<HTMLElement>('[data-design-theme-choice="md3"]')!
  expect(md3.dataset.state, "默认没落在 Native 上").not.toBe("on")
  md3.click()

  await expect.poll(() => document.documentElement.dataset.appDesign).toBe("md3")
  await expect
    .poll(() => document.querySelector<HTMLElement>('[data-design-theme-choice="md3"]')?.dataset.state)
    .toBe("on")
  await page.getByTestId("design-language-group").screenshot({ path: ".cache/topbar-design-language.png" })
  // 真的写了变量，而不是只换了个属性。
  expect(Number(document.documentElement.dataset.designAppliedVars ?? "0")).toBeGreaterThan(60)

  const native = document.querySelector<HTMLElement>('[data-design-theme-choice="native"]')!
  native.click()
  await expect.poll(() => document.documentElement.dataset.appDesign).toBe("native")

  useWorkspaceStore.getState().setDesignTheme({ ...DEFAULT_DESIGN_THEME })
})

function TopBarHarness() {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  }))

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      storageKey="xiranite-topbar-browser"
    >
      <QueryClientProvider client={queryClient}>
        <TopBar />
      </QueryClientProvider>
    </ThemeProvider>
  )
}
