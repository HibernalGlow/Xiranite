import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import ImageTrimCard, { type ImageTrimPatch, type ImageTrimPort, type ImageTrimSettings } from "./ImageTrimCard"
import type { ReaderImageTrimDetectionOutcome } from "../../image-trim/ReaderImageTrimStore"

afterEach(cleanup)

describe("ImageTrimCard", () => {
  it("[neoview.image-trim.loading] remains resident while the injected configuration hydrates", () => {
    const view = render(<ImageTrimCard />)
    expect(view.container.querySelector('[data-neoview-card="image-trim"]')).toBeTruthy()
    expect(view.container.querySelector('[data-image-trim-state="loading"]')).toBeTruthy()
    expect(screen.getByText("图像裁剪配置加载中...")).toBeTruthy()
  })

  it("[neoview.image-trim.panel-active] pauses the alias port while hidden and subscribes after activation", () => {
    const port = memoryPort({ ...defaults(), enabled: true })
    const subscribe = vi.spyOn(port, "subscribe")
    const view = render(<ImageTrimCard imageTrim={port} panelActive={false} />)

    expect(subscribe).not.toHaveBeenCalled()
    expect(view.container.querySelector('[data-image-trim-state="loading"]')).toBeTruthy()
    expect(screen.queryByRole("switch", { name: "启用图像裁剪" })).toBeNull()

    view.rerender(<ImageTrimCard imageTrim={port} panelActive />)

    expect(subscribe).toHaveBeenCalledOnce()
    expect(view.container.querySelector('[data-image-trim-state="ready"]')).toBeTruthy()
    expect(screen.getByRole("switch", { name: "启用图像裁剪" })).toBeTruthy()
  })

  it("[neoview.image-trim.lifecycle] releases the port subscription when hidden or unmounted", () => {
    const port = memoryPort({ ...defaults(), enabled: true })
    const view = render(<ImageTrimCard port={port} />)
    view.rerender(<ImageTrimCard port={port} panelActive={false} />)
    expect(port.unsubscribe).toHaveBeenCalledOnce()
    view.rerender(<ImageTrimCard port={port} />)
    view.unmount()
    expect(port.unsubscribe).toHaveBeenCalledTimes(2)
  })

  it("[neoview.image-trim.ui] [neoview.image-trim.enable] preserves the legacy control hierarchy and icon actions", () => {
    render(<ImageTrimCard port={memoryPort({ ...defaults(), enabled: true, top: 5, linkVertical: true, linkHorizontal: true })} />)
    expect(screen.getByRole("switch", { name: "启用图像裁剪" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "重置所有裁剪" })).toBeTruthy()
    expect(screen.getAllByRole("slider")).toHaveLength(5)
    expect(screen.getByRole("button", { name: "上取消联动" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "左取消联动" })).toBeTruthy()
    expect(screen.getByTestId("image-trim-preview")).toBeTruthy()
    expect(screen.getByRole("button", { name: "自动检测" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "去黑边" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "去白边" })).toBeTruthy()
    expect(screen.getByRole("slider", { name: "容差" })).toBeTruthy()
    expect(screen.getByRole("combobox", { name: "目标颜色" })).toBeTruthy()
  })

  it("[neoview.image-trim.slider-commit] [neoview.image-trim.threshold] previews range movement and commits once at pointer/key end", () => {
    const port = memoryPort({ ...defaults(), enabled: true })
    render(<ImageTrimCard port={port} />)
    const top = screen.getByRole("slider", { name: "上" })
    fireEvent.change(top, { target: { value: "12" } })
    fireEvent.change(top, { target: { value: "18" } })
    expect(port.preview).toHaveBeenCalledTimes(2)
    expect(port.commit).not.toHaveBeenCalled()
    fireEvent.pointerUp(top, { pointerId: 1 })
    expect(port.commit).toHaveBeenCalledOnce()

    const threshold = screen.getByRole("slider", { name: "容差" })
    fireEvent.change(threshold, { target: { value: "40" } })
    fireEvent.keyUp(threshold, { key: "ArrowRight" })
    expect(port.commit).toHaveBeenCalledTimes(2)
  })

  it("[neoview.image-trim.actions] [neoview.image-trim.reset] [neoview.image-trim.target] exposes testable reset, link, preset and target actions", () => {
    const port = memoryPort({ ...defaults(), enabled: true, top: 7, linkVertical: true, linkHorizontal: true })
    render(<ImageTrimCard port={port} />)
    fireEvent.click(screen.getByRole("button", { name: "上取消联动" }))
    expect(port.update).toHaveBeenCalledWith({ linkVertical: false })
    fireEvent.click(screen.getByRole("button", { name: "左取消联动" }))
    expect(port.update).toHaveBeenCalledWith({ linkHorizontal: false })
    fireEvent.click(screen.getByRole("button", { name: "去黑边" }))
    expect(port.presetBlack).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole("button", { name: "去白边" }))
    expect(port.presetWhite).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole("combobox", { name: "目标颜色" }), { target: { value: "white" } })
    expect(port.update).toHaveBeenCalledWith({ autoTrimTarget: "white" })
    fireEvent.click(screen.getByRole("button", { name: "重置所有裁剪" }))
    expect(port.reset).toHaveBeenCalledOnce()
  })

  it("[neoview.image-trim.action-status] reports detecting, success and no-border states", async () => {
    const port = memoryPort({ ...defaults(), enabled: true })
    let finish!: (outcome: ReaderImageTrimDetectionOutcome) => void
    port.autoDetect.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    render(<ImageTrimCard port={port} />)

    fireEvent.click(screen.getByRole("button", { name: "自动检测" }))
    expect((screen.getByRole("button", { name: "检测中..." }) as HTMLButtonElement).disabled).toBe(true)
    finish({ status: "applied", margins: { top: 10, bottom: 11, left: 12, right: 13 } })
    await waitFor(() => expect(screen.getByText(/检测完成:/).textContent).toContain("10.0%"))

    fireEvent.click(screen.getByRole("button", { name: "自动检测" }))
    await waitFor(() => expect(screen.getByText("未检测到明显边框")).toBeTruthy())
  })

  it("[neoview.image-trim.error-retry] preserves a retryable error state", async () => {
    const port = memoryPort({ ...defaults(), enabled: true })
    port.autoDetect.mockRejectedValueOnce(new Error("canvas failed"))
    render(<ImageTrimCard port={port} />)

    fireEvent.click(screen.getByRole("button", { name: "自动检测" }))
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("检测失败，请重试"))
    fireEvent.click(screen.getByRole("button", { name: "自动检测" }))
    await waitFor(() => expect(screen.getByText("未检测到明显边框")).toBeTruthy())
    expect(port.autoDetect).toHaveBeenCalledTimes(2)
  })

  it("[neoview.image-trim.messages] [neoview.image-trim.black-border] [neoview.image-trim.white-border] reports unavailable and preset success states", async () => {
    const port = memoryPort({ ...defaults(), enabled: true })
    port.autoDetect.mockResolvedValueOnce({ status: "unavailable" })
    port.presetBlack.mockResolvedValueOnce({ status: "applied", margins: { top: 5, bottom: 5, left: 5, right: 5 } })
    render(<ImageTrimCard port={port} />)

    fireEvent.click(screen.getByRole("button", { name: "自动检测" }))
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("未找到已解码的当前图片"))
    fireEvent.click(screen.getByRole("button", { name: "去黑边" }))
    await waitFor(() => expect(screen.getByText("已应用去黑边")).toBeTruthy())
    port.presetWhite.mockResolvedValueOnce({ status: "applied", margins: { top: 4, bottom: 4, left: 4, right: 4 } })
    fireEvent.click(screen.getByRole("button", { name: "去白边" }))
    await waitFor(() => expect(screen.getByText("已应用去白边")).toBeTruthy())
  })

  it("[neoview.image-trim.cancel] cancels detection when the Card becomes hidden", () => {
    const port = memoryPort({ ...defaults(), enabled: true })
    const view = render(<ImageTrimCard port={port} />)

    view.rerender(<ImageTrimCard port={port} panelActive={false} />)

    expect(port.cancelDetection).toHaveBeenCalled()
    view.unmount()
    expect(port.cancelDetection.mock.calls.length).toBeGreaterThan(1)
  })
})

function defaults(): ImageTrimSettings {
  return {
    enabled: false,
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    linkVertical: false,
    linkHorizontal: false,
    autoTrimThreshold: 30,
    autoTrimTarget: "auto",
  }
}

function memoryPort(initial = defaults()): ImageTrimPort & {
  preview: ReturnType<typeof vi.fn<(patch: ImageTrimPatch) => void>>
  commit: ReturnType<typeof vi.fn<() => Promise<void>>>
  update: ReturnType<typeof vi.fn<(patch: ImageTrimPatch) => Promise<void>>>
  reset: ReturnType<typeof vi.fn<() => Promise<void>>>
  autoDetect: ReturnType<typeof vi.fn<() => Promise<ReaderImageTrimDetectionOutcome>>>
  presetBlack: ReturnType<typeof vi.fn<() => Promise<ReaderImageTrimDetectionOutcome>>>
  presetWhite: ReturnType<typeof vi.fn<() => Promise<ReaderImageTrimDetectionOutcome>>>
  cancelDetection: ReturnType<typeof vi.fn<() => void>>
  unsubscribe: ReturnType<typeof vi.fn<() => void>>
} {
  let snapshot = initial
  const listeners = new Set<() => void>()
  const unsubscribe = vi.fn<() => void>()
  const publish = (patch: ImageTrimPatch) => {
    snapshot = { ...snapshot, ...patch }
    for (const listener of listeners) listener()
  }
  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        unsubscribe()
        listeners.delete(listener)
      }
    },
    getSnapshot: () => snapshot,
    preview: vi.fn((patch: ImageTrimPatch) => { publish(patch) }),
    commit: vi.fn(async () => undefined),
    update: vi.fn(async (patch: ImageTrimPatch) => { publish(patch) }),
    reset: vi.fn(async () => { snapshot = defaults(); for (const listener of listeners) listener() }),
    autoDetect: vi.fn(async () => ({ status: "no-border" as const })),
    presetBlack: vi.fn(async () => ({ status: "no-border" as const })),
    presetWhite: vi.fn(async () => ({ status: "no-border" as const })),
    cancelDetection: vi.fn(),
    unsubscribe,
  }
}
