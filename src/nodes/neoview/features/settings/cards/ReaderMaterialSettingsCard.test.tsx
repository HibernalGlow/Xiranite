import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderShellConfigDto } from "../../../adapters/reader-http-client"
import { ReaderMaterialSettingsCard } from "./ReaderMaterialSettingsCard"

afterEach(cleanup)

describe("ReaderMaterialSettingsCard", () => {
  it("[neoview.material.preview-persistence] previews locally and commits once on release", async () => {
    const shell = createShell()
    const onMaterial = vi.fn(async (patch) => createShell({
      revision: 2,
      blur: patch.blur as ReaderShellConfigDto["blur"],
      material: {
        ...shell.material!,
        preset: patch.preset ?? shell.material!.preset,
        saturation: patch.saturation as NonNullable<ReaderShellConfigDto["material"]>["saturation"],
        highlight: patch.highlight as NonNullable<ReaderShellConfigDto["material"]>["highlight"],
        shadow: patch.shadow as NonNullable<ReaderShellConfigDto["material"]>["shadow"],
      },
    }))
    render(<><div data-reader-edge-chrome="top" /><ReaderMaterialSettingsCard shell={shell} onMaterial={onMaterial} /></>)

    const slider = screen.getByRole("slider", { name: "顶栏背景模糊" })
    fireEvent.change(slider, { target: { value: "5" } })

    expect(document.querySelector<HTMLElement>('[data-reader-edge-chrome="top"]')?.style.backdropFilter).toContain("blur(5px)")
    expect(onMaterial).not.toHaveBeenCalled()

    fireEvent.pointerUp(slider)
    await waitFor(() => expect(onMaterial).toHaveBeenCalledTimes(1))
    expect(onMaterial).toHaveBeenCalledWith(expect.objectContaining({
      preset: "custom",
      blur: { top: 5, bottom: 5, sidebar: 5 },
    }))
  })

  it("[neoview.material.rollback] restores the confirmed preview when persistence fails", async () => {
    const onMaterial = vi.fn(async () => { throw new Error("write failed") })
    render(<><div data-reader-edge-chrome="top" /><ReaderMaterialSettingsCard shell={createShell()} onMaterial={onMaterial} /></>)

    const slider = screen.getByRole("slider", { name: "顶栏背景模糊" })
    fireEvent.change(slider, { target: { value: "3" } })
    fireEvent.pointerUp(slider)

    expect((await screen.findByRole("alert")).textContent).toContain("write failed")
    expect((slider as HTMLInputElement).value).toBe("12")
    expect(document.querySelector<HTMLElement>('[data-reader-edge-chrome="top"]')?.style.backdropFilter).toContain("blur(12px)")
    expect(onMaterial).toHaveBeenCalledTimes(1)
  })

  it("[neoview.material.presets] previews and persists one complete preset", async () => {
    const onMaterial = vi.fn(async () => createShell({
      opacity: { top: 92, bottom: 92, sidebar: 92 },
      blur: { top: 8, bottom: 8, sidebar: 8 },
      material: {
        preset: "soft",
        saturation: { top: 108, bottom: 108, sidebar: 108 },
        highlight: { top: 20, bottom: 20, sidebar: 20 },
        shadow: { top: 36, bottom: 36, sidebar: 36 },
      },
    }))
    render(<><div data-reader-edge-chrome="top" /><ReaderMaterialSettingsCard shell={createShell()} onMaterial={onMaterial} /></>)

    fireEvent.click(screen.getByRole("button", { name: "轻透" }))

    await waitFor(() => expect(onMaterial).toHaveBeenCalledTimes(1))
    expect(onMaterial).toHaveBeenCalledWith({
      preset: "soft",
      opacity: { top: 92, bottom: 92, sidebar: 92 },
      blur: { top: 8, bottom: 8, sidebar: 8 },
      saturation: { top: 108, bottom: 108, sidebar: 108 },
      highlight: { top: 20, bottom: 20, sidebar: 20 },
      shadow: { top: 36, bottom: 36, sidebar: 36 },
    })
    expect(document.querySelector<HTMLElement>('[data-reader-edge-chrome="top"]')?.style.backdropFilter).toContain("saturate(108%)")
  })

  it("restores an uncommitted preview when the settings card unmounts", () => {
    const onMaterial = vi.fn(async () => createShell())
    const edge = document.createElement("div")
    edge.dataset.readerEdgeChrome = "top"
    document.body.append(edge)
    const view = render(<ReaderMaterialSettingsCard shell={createShell()} onMaterial={onMaterial} />)
    const slider = screen.getByRole("slider", { name: "顶栏背景模糊" })

    fireEvent.change(slider, { target: { value: "2" } })
    expect(edge.style.backdropFilter).toContain("blur(2px)")
    view.unmount()

    expect(edge.style.backdropFilter).toContain("blur(12px)")
    expect(onMaterial).not.toHaveBeenCalled()
    edge.remove()
  })
})

function createShell(overrides: Partial<ReaderShellConfigDto> = {}): ReaderShellConfigDto {
  return {
    revision: 1,
    showDelayMs: 0,
    hideDelayMs: 0,
    opacity: { top: 85, bottom: 85, sidebar: 85 },
    blur: { top: 12, bottom: 12, sidebar: 12 },
    material: {
      preset: "frosted",
      saturation: { top: 115, bottom: 115, sidebar: 115 },
      highlight: { top: 35, bottom: 35, sidebar: 35 },
      shadow: { top: 45, bottom: 45, sidebar: 45 },
    },
    edges: {
      top: { enabled: true, initialVisible: true, pinned: false, triggerSize: 32 },
      right: { enabled: true, initialVisible: false, pinned: false, triggerSize: 32 },
      bottom: { enabled: true, initialVisible: false, pinned: false, triggerSize: 32 },
      left: { enabled: true, initialVisible: true, pinned: true, triggerSize: 32 },
    },
    sidebars: {
      left: { width: 320, height: "full", customHeight: 100, verticalAlign: 0, horizontalPosition: 0 },
      right: { width: 280, height: "full", customHeight: 100, verticalAlign: 0, horizontalPosition: 0 },
    },
    panelLayout: {},
    cardLayout: {},
    ...overrides,
  }
}
