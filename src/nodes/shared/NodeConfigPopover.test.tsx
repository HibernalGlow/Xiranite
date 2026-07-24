// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TooltipProvider } from "@/components/ui/tooltip"
import { createCapabilityAdapters, NodeConfigPopover } from "./NodeConfigPopover"

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
      tomlSource={'[nodes.neoview]\ncolumns = 2\n'}
      triggerLabel="Configuration center"
      presentation={{ current: () => <div>NeoView configuration summary</div> }}
      t={translate}
      onReload={vi.fn()}
      onRestore={vi.fn()}
      onSave={vi.fn()}
    />)
    await user.click(screen.getByRole("button", { name: "Configuration center" }))
    expect(await screen.findByText("NeoView configuration summary")).toBeTruthy()
    expect(await screen.findByText("TOML source")).toBeTruthy()
  })

  test("adapts injected node config capabilities for any configuration center", async () => {
    const reload = vi.fn()
    const getVersions = vi.fn().mockResolvedValue({ versions: [] })
    const restoreVersion = vi.fn().mockResolvedValue({ config: {}, path: "xiranite.config.toml" })
    const exportConfig = vi.fn().mockResolvedValue({ content: "", filename: "demo.toml", mimeType: "application/toml" })
    const importConfig = vi.fn().mockResolvedValue({ config: {}, path: "xiranite.config.toml" })
    const adapters = createCapabilityAdapters({
      getVersions,
      inspectVersion: vi.fn(),
      restoreVersion,
      exportConfig,
      importConfig,
      getHistoryRepository: vi.fn(),
      createBackup: vi.fn(),
      setHistoryRemote: vi.fn(),
      syncHistory: vi.fn(),
    } as never, reload)

    await adapters.history?.list({ limit: 5 })
    await adapters.history?.restore("revision-1")
    await adapters.transfer?.export("toml")
    await adapters.transfer?.import("[nodes.demo]", "toml")

    expect(getVersions).toHaveBeenCalledWith({ limit: 5 })
    expect(restoreVersion).toHaveBeenCalledWith("revision-1")
    expect(reload).toHaveBeenCalledTimes(1)
    expect(exportConfig).toHaveBeenCalledWith("toml")
    expect(importConfig).toHaveBeenCalledWith("[nodes.demo]", "toml")
    expect(adapters.backup).toBeTruthy()
  })

  test("renders canonical TOML with lazily loaded Shiki highlighting", async () => {
    const user = userEvent.setup()
    renderWithProviders(<NodeConfigPopover
      dirty={false}
      defaults={{ accent: "#22c55e", enabled: true }}
      tomlSource={'[nodes.demo]\naccent = "#22c55e"\nenabled = true\n'}
      triggerLabel="Configuration center"
      t={translate}
      onReload={vi.fn()}
      onRestore={vi.fn()}
      onSave={vi.fn()}
    />)

    await user.click(screen.getByRole("button", { name: "Configuration center" }))
    expect(await screen.findByText("TOML source")).toBeTruthy()
    await waitFor(() => expect(document.querySelector(".node-config-toml .shiki")).toBeTruthy())
    expect(screen.queryByText('"accent": "#22c55e"')).toBeNull()
    expect(screen.getAllByText("#22c55e").length).toBeGreaterThan(0)
    const sourceScroll = document.querySelector('[data-node-config-source-scroll="true"]')
    expect(sourceScroll?.className).toContain("h-[min(30rem,calc(100dvh-12rem))]")
    expect(sourceScroll?.className).toContain("overflow-hidden")
    expect(sourceScroll?.getAttribute("data-input-interactive")).toBe("true")
    expect(sourceScroll?.querySelector('[data-slot="scroll-area-viewport"]')).toBeTruthy()
  })
})

const translate = (_key: string, fallback?: string) => fallback ?? _key

function renderWithProviders(element: React.ReactElement) {
  return render(<TooltipProvider>{element}</TooltipProvider>)
}
