import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import InfoOverlayCard, { type InfoOverlayPatch, type InfoOverlayPort, type InfoOverlaySettings } from "./InfoOverlayCard"

afterEach(cleanup)

describe("InfoOverlayCard", () => {
  it("[neoview.info-overlay.inactive-zero-subscription] keeps an empty shell while hidden", () => {
    const port = memoryPort()
    const subscribe = vi.spyOn(port, "subscribe")
    render(<InfoOverlayCard port={port} panelActive={false} />)

    expect(document.querySelector('[data-reader-card-empty="true"]')).toBeTruthy()
    expect(subscribe).not.toHaveBeenCalled()
    expect(screen.queryByRole("switch")).toBeNull()
  })

  it("[neoview.info-overlay.navigation-independence] disables native controls while navigation is busy", () => {
    render(<InfoOverlayCard port={memoryPort()} disabled />)

    expect((screen.getAllByRole("switch")[0] as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole("spinbutton") as HTMLInputElement).disabled).toBe(true)
    expect((screen.getAllByRole("slider")[0] as HTMLInputElement).hasAttribute("data-disabled")).toBe(true)
  })

  it("[neoview.info-overlay.loading] remains mounted while configuration is unavailable", () => {
    const view = render(<InfoOverlayCard />)
    expect(view.container.querySelector('[data-neoview-card="info-overlay"]')).toBeTruthy()
    const loading = view.container.querySelector('[data-info-overlay-state="loading"]')
    expect(loading).toBeTruthy()
    expect(loading?.getAttribute("role")).toBe("status")
    expect(loading?.getAttribute("aria-live")).toBe("polite")
    expect(screen.getByText("信息悬浮窗配置加载中...")).toBeTruthy()
  })

  it("[neoview.info-overlay.ui] preserves the legacy controls, automatic labels and explanation", () => {
    render(<InfoOverlayCard port={memoryPort()} />)
    expect(screen.getAllByRole("switch")).toHaveLength(2)
    expect(screen.getByRole("switch", { name: "启用悬浮窗" })).toBeTruthy()
    expect(screen.getByRole("spinbutton", { name: "透明度百分比" })).toBeTruthy()
    expect(screen.getByRole("slider", { name: "宽度" }).getAttribute("aria-valuenow")).toBe("480")
    expect(screen.getByRole("slider", { name: "高度" }).getAttribute("aria-valuenow")).toBe("56")
    expect(screen.getAllByText("自动")).toHaveLength(2)
    expect(screen.getByText("调节悬浮信息窗的背景透明度（0% - 100%，0% 为仅文字无底色）。")).toBeTruthy()
  })

  it("[neoview.info-overlay.alias] treats infoOverlay as the active port", () => {
    const infoOverlay = memoryPort()
    const view = render(<InfoOverlayCard infoOverlay={infoOverlay} />)

    expect(view.container.querySelector('[data-info-overlay-state="ready"]')).toBeTruthy()
    fireEvent.click(screen.getAllByRole("switch")[0])
    expect(infoOverlay.update).toHaveBeenCalledWith({ enabled: true })
  })

  it("[neoview.info-overlay.number-commit] keeps opacity edits local until blur and clamps once", () => {
    const port = memoryPort()
    render(<InfoOverlayCard port={port} />)
    const opacity = screen.getByRole("spinbutton", { name: "透明度百分比" })
    fireEvent.focus(opacity)
    fireEvent.change(opacity, { target: { value: "125" } })
    expect(port.update).not.toHaveBeenCalled()
    fireEvent.blur(opacity)
    expect(port.update).toHaveBeenCalledOnce()
    expect(port.update).toHaveBeenCalledWith({ opacity: 1 })
  })

  it("[neoview.info-overlay.slider-commit] previews slider movement and commits only at interaction end", () => {
    const port = memoryPort()
    render(<InfoOverlayCard port={port} />)
    const width = screen.getByRole("slider", { name: "宽度" })
    fireEvent.keyDown(width, { key: "ArrowRight" })
    expect(port.preview).toHaveBeenCalled()
    // Radix treats each keyboard increment as a complete interaction.
    expect(port.commit).toHaveBeenCalledOnce()
    fireEvent.keyUp(width, { key: "ArrowRight" })
    expect(port.commit).toHaveBeenCalledOnce()
  })

  it("[neoview.info-overlay.switches] commits each discrete switch independently of session state", () => {
    const port = memoryPort()
    render(<InfoOverlayCard port={port} />)
    fireEvent.click(screen.getByRole("switch", { name: "启用悬浮窗" }))
    fireEvent.click(screen.getByRole("switch", { name: "显示边框" }))
    expect(port.update).toHaveBeenNthCalledWith(1, { enabled: true })
    expect(port.update).toHaveBeenNthCalledWith(2, { showBorder: true })
  })

  it("[neoview.info-overlay.auto-size] exposes an explicit reset for fixed dimensions", () => {
    const port = memoryPort({ ...defaults(), width: 480, height: 56 })
    render(<InfoOverlayCard port={port} />)
    fireEvent.click(screen.getByRole("button", { name: "宽度恢复自动" }))
    expect(port.preview).toHaveBeenCalledWith({ width: null })
    expect(port.commit).toHaveBeenCalledOnce()
  })

  it("[neoview.info-overlay.persistence] reports save failure and retries the latest update", async () => {
    const port = memoryPort()
    const update = vi.fn<(patch: InfoOverlayPatch) => Promise<void>>()
      .mockRejectedValueOnce(new Error("write failed"))
      .mockResolvedValueOnce(undefined)
    port.update = update
    render(<InfoOverlayCard port={port} />)

    fireEvent.click(screen.getByRole("switch", { name: "启用悬浮窗" }))
    expect((await screen.findByRole("alert")).textContent).toContain("信息悬浮窗保存失败")
    fireEvent.click(screen.getByRole("button", { name: "重试保存" }))

    await waitFor(() => expect(update).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("[neoview.info-overlay.lifecycle] unsubscribes hidden editors and drops late save errors", async () => {
    const port = memoryPort()
    const unsubscribe = vi.fn()
    vi.spyOn(port, "subscribe").mockReturnValue(unsubscribe)
    let rejectUpdate: (cause?: unknown) => void = () => undefined
    port.update = vi.fn(() => new Promise<void>((_, reject) => { rejectUpdate = reject }))
    const view = render(<InfoOverlayCard port={port} />)

    fireEvent.click(screen.getByRole("switch", { name: "启用悬浮窗" }))
    await waitFor(() => expect(port.update).toHaveBeenCalledOnce())
    view.rerender(<InfoOverlayCard port={port} panelActive={false} />)
    expect(unsubscribe).toHaveBeenCalledOnce()
    rejectUpdate(new Error("late failure"))
    await Promise.resolve()
    view.rerender(<InfoOverlayCard port={port} panelActive />)

    expect(screen.queryByRole("alert")).toBeNull()
    view.unmount()
  })
})

function defaults(): InfoOverlaySettings {
  return { enabled: false, opacity: 0.85, showBorder: false }
}

function memoryPort(initial = defaults()): InfoOverlayPort & {
  preview: ReturnType<typeof vi.fn<(patch: InfoOverlayPatch) => void>>
  commit: ReturnType<typeof vi.fn<() => Promise<void>>>
  update: ReturnType<typeof vi.fn<(patch: InfoOverlayPatch) => Promise<void>>>
} {
  let snapshot = initial
  const listeners = new Set<() => void>()
  const publish = (patch: InfoOverlayPatch) => {
    snapshot = { ...snapshot, ...patch }
    for (const listener of listeners) listener()
  }
  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => snapshot,
    preview: vi.fn((patch: InfoOverlayPatch) => { publish(patch) }),
    commit: vi.fn(async () => undefined),
    update: vi.fn(async (patch: InfoOverlayPatch) => { publish(patch) }),
  }
}
