import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ThemeProvider } from "next-themes"
import { useState } from "react"
import { afterEach, expect, test, vi } from "vitest"
import { cleanup, render } from "vitest-browser-react"
import { TopBar } from "./TopBar"

const runtime = vi.hoisted(() => ({
  openDevTools: vi.fn(async () => ({ success: true, supported: true, message: "Developer tools opened." })),
}))

vi.mock("@/components/workspace/WorkspaceMelodeck", () => ({
  WorkspaceMelodeckTopBarSlot: () => <div data-melodeck="topbar-slot-test" />,
}))

vi.mock("@/backend/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/backend/client")>()
  return {
    ...actual,
    getRuntime: vi.fn(async () => ({ kind: "wails", windows: { openDevTools: runtime.openDevTools } })),
  }
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

test("keeps the theme palette tint off the titlebar shell", async () => {
  await render(<TopBarHarness />)

  const titlebar = document.querySelector<HTMLElement>(".xiranite-topbar")!
  expect(titlebar.style.backgroundColor).toBe("")
  expect(titlebar.dataset.titlebarPaletteSlot).toBeUndefined()
  expect(titlebar.classList.contains("bg-background")).toBe(true)
  expect(titlebar.querySelector('[data-melodeck="topbar-slot-test"]')).not.toBeNull()
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
