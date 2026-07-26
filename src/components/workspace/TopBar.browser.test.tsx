import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ThemeProvider } from "next-themes"
import { useState } from "react"
import { afterEach, expect, test, vi } from "vitest"
import { cleanup, render } from "vitest-browser-react"
import { TopBar } from "./TopBar"

vi.mock("@/components/workspace/WorkspaceMelodeck", () => ({
  WorkspaceMelodeckTopBarSlot: () => <div data-melodeck="topbar-slot-test" />,
}))

afterEach(cleanup)

test("keeps the theme palette tint off the titlebar shell", async () => {
  await render(<TopBarHarness />)

  const titlebar = document.querySelector<HTMLElement>(".xiranite-topbar")!
  expect(titlebar.style.backgroundColor).toBe("")
  expect(titlebar.dataset.titlebarPaletteSlot).toBeUndefined()
  expect(titlebar.classList.contains("bg-background")).toBe(true)
  expect(titlebar.querySelector('[data-melodeck="topbar-slot-test"]')).not.toBeNull()
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
