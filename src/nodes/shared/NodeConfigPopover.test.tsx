// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TooltipProvider } from "@/components/ui/tooltip"
import { NodeConfigPopover } from "./NodeConfigPopover"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("NodeConfigPopover configuration center", () => {
  test("keeps history off the hot path and loads it only when its tab opens", async () => {
    const list = vi.fn().mockResolvedValue({ versions: [] })
    const user = userEvent.setup()

    renderWithProviders(<NodeConfigPopover
      dirty={false}
      defaults={{ reader: { columns: 2 } }}
      triggerLabel="Configuration center"
      history={{
        list,
        inspect: vi.fn(),
        restore: vi.fn(),
      }}
      t={translate}
      onReload={vi.fn()}
      onRestore={vi.fn()}
      onSave={vi.fn()}
    />)

    expect(list).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "Configuration center" }))

    expect(await screen.findByRole("dialog", { name: "Configuration center" })).toBeTruthy()
    expect(list).not.toHaveBeenCalled()
    expect(screen.getByRole("tab", { name: "Current configuration" })).toBeTruthy()
    expect(screen.getByRole("tab", { name: "Presets" })).toBeTruthy()
    expect(screen.getByRole("tab", { name: "Change history" })).toBeTruthy()
    expect(screen.getByRole("tab", { name: "Import / export" })).toBeTruthy()
    expect(screen.getByRole("tab", { name: "Backup / sync" })).toBeTruthy()

    await user.click(screen.getByRole("tab", { name: "Change history" }))
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1))
  })

  test("uses the structured fallback while allowing a node-owned current view", async () => {
    const user = userEvent.setup()
    const view = renderWithProviders(<NodeConfigPopover
      dirty={false}
      defaults={{ reader: { columns: 2 } }}
      triggerLabel="Configuration center"
      t={translate}
      onReload={vi.fn()}
      onRestore={vi.fn()}
      onSave={vi.fn()}
    />)

    await user.click(screen.getByRole("button", { name: "Configuration center" }))
    expect(await screen.findByText('"columns": 2')).toBeTruthy()

    view.unmount()
    renderWithProviders(<NodeConfigPopover
      dirty={false}
      defaults={{ reader: { columns: 2 } }}
      triggerLabel="Configuration center"
      presentation={{ current: () => <div>NeoView configuration summary</div> }}
      t={translate}
      onReload={vi.fn()}
      onRestore={vi.fn()}
      onSave={vi.fn()}
    />)
    await user.click(screen.getByRole("button", { name: "Configuration center" }))
    expect(await screen.findByText("NeoView configuration summary")).toBeTruthy()
  })
})

const translate = (_key: string, fallback?: string) => fallback ?? _key

function renderWithProviders(element: React.ReactElement) {
  return render(<TooltipProvider>{element}</TooltipProvider>)
}
