import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import ImageTrimCard, { type ImageTrimPatch, type ImageTrimPort, type ImageTrimSettings } from "./ImageTrimCard"

afterEach(cleanup)

describe("ImageTrimCard", () => {
  it("[neoview.image-trim.loading] remains resident while the injected configuration hydrates", () => {
    const view = render(<ImageTrimCard />)
    expect(view.container.querySelector('[data-neoview-card="image-trim"]')).toBeTruthy()
    expect(view.container.querySelector('[data-image-trim-state="loading"]')).toBeTruthy()
    expect(screen.getByText("图像裁剪配置加载中...")).toBeTruthy()
  })

  it("[neoview.image-trim.ui] preserves the legacy control hierarchy and icon actions", () => {
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

  it("[neoview.image-trim.slider-commit] previews range movement and commits once at pointer/key end", () => {
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

  it("[neoview.image-trim.actions] exposes testable reset, link, preset and target actions", () => {
    const port = memoryPort({ ...defaults(), enabled: true, top: 7, linkVertical: true, linkHorizontal: true })
    render(<ImageTrimCard port={port} />)
    fireEvent.click(screen.getByRole("button", { name: "上取消联动" }))
    expect(port.update).toHaveBeenCalledWith({ linkVertical: false })
    fireEvent.click(screen.getByRole("button", { name: "去黑边" }))
    expect(port.presetBlack).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole("button", { name: "去白边" }))
    expect(port.presetWhite).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole("combobox", { name: "目标颜色" }), { target: { value: "white" } })
    expect(port.update).toHaveBeenCalledWith({ autoTrimTarget: "white" })
    fireEvent.click(screen.getByRole("button", { name: "重置所有裁剪" }))
    expect(port.reset).toHaveBeenCalledOnce()
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
  autoDetect: ReturnType<typeof vi.fn<() => Promise<void>>>
  presetBlack: ReturnType<typeof vi.fn<() => Promise<void>>>
  presetWhite: ReturnType<typeof vi.fn<() => Promise<void>>>
} {
  let snapshot = initial
  const listeners = new Set<() => void>()
  const publish = (patch: ImageTrimPatch) => {
    snapshot = { ...snapshot, ...patch }
    for (const listener of listeners) listener()
  }
  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => snapshot,
    preview: vi.fn((patch: ImageTrimPatch) => { publish(patch) }),
    commit: vi.fn(async () => undefined),
    update: vi.fn(async (patch: ImageTrimPatch) => { publish(patch) }),
    reset: vi.fn(async () => { snapshot = defaults(); for (const listener of listeners) listener() }),
    autoDetect: vi.fn(async () => undefined),
    presetBlack: vi.fn(async () => undefined),
    presetWhite: vi.fn(async () => undefined),
  }
}
