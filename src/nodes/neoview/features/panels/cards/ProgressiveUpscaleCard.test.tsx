import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderHttpClient, ReaderRuntimeConfigDto, ReaderSuperResolutionConfigDto } from "../../../adapters/reader-http-client"
import ProgressiveUpscaleCard from "./ProgressiveUpscaleCard"

afterEach(cleanup)

describe("ProgressiveUpscaleCard", () => {
  it("[neoview.progressive-upscale.resident] renders settings without a Reader session", async () => {
    const client = clientFixture()
    render(<ProgressiveUpscaleCard client={client} disabled={false} />)

    await waitFor(() => expect(screen.getByRole("switch", { name: "预超分" })).toBeTruthy())
    expect(screen.getByText("需要先启用“自动超分”才能生效")).toBeTruthy()
    expect(screen.getByText("0 / 0")).toBeTruthy()
  })

  it("[neoview.progressive-upscale.panel-resident] keeps the full Card mounted when its panel is inactive", async () => {
    const client = clientFixture()
    render(<ProgressiveUpscaleCard client={client} disabled={false} panelActive={false} />)

    await waitFor(() => expect(screen.getByRole("switch", { name: "自动超分" })).toBeTruthy())
    expect(screen.getByRole("switch", { name: "预超分" }).hasAttribute("disabled")).toBe(true)
    expect(document.querySelector("[data-neoview-progressive-upscale]")?.getAttribute("data-panel-active")).toBe("false")
  })

  it("[neoview.progressive-upscale.settings] persists the source switches and bounded select values", async () => {
    const client = clientFixture(true)
    render(<ProgressiveUpscaleCard client={client} disabled={false} />)
    await waitFor(() => expect(screen.getByRole("switch", { name: "递进超分" })).toBeTruthy())

    fireEvent.click(screen.getByRole("switch", { name: "递进超分" }))
    await waitFor(() => expect(client.updateSuperResolution).toHaveBeenCalledWith({ superResolution: { preferences: { progressiveEnabled: true } } }))

    fireEvent.change(screen.getByRole("combobox", { name: "预加载页数" }), { target: { value: "10" } })
    await waitFor(() => expect(client.updateSuperResolution).toHaveBeenCalledWith({ superResolution: { preferences: { preloadPages: 10 } } }))
  })

  it("[neoview.upscale-control.settings] persists the legacy automatic master switch through the shared Reader config", async () => {
    const client = clientFixture(false)
    const onSuperResolutionChange = vi.fn(async () => ({
      provider: "opencomic-system" as const,
      preferences: { ...DEFAULT_TEST_PREFERENCES, autoUpscaleEnabled: true },
    }))
    render(<ProgressiveUpscaleCard client={client} disabled={false} onSuperResolutionChange={onSuperResolutionChange} />)
    await waitFor(() => expect(screen.getByRole("switch", { name: "自动超分" })).toBeTruthy())

    fireEvent.click(screen.getByRole("switch", { name: "自动超分" }))

    await waitFor(() => expect(onSuperResolutionChange).toHaveBeenCalledWith({ autoUpscaleEnabled: true }))
    expect(screen.getByText("切换图片时自动执行超分（全局主开关）")).toBeTruthy()
  })
})

const DEFAULT_TEST_PREFERENCES = {
  autoUpscaleEnabled: false,
  preUpscaleEnabled: true,
  preloadPages: 3,
  backgroundConcurrency: 2,
  progressiveEnabled: false,
  progressiveDwellTimeMs: 3_000,
  progressiveMaxPages: 20,
}

function clientFixture(autoUpscaleEnabled = false): ReaderHttpClient {
  const superResolution: ReaderSuperResolutionConfigDto = {
    provider: "opencomic-system",
    preferences: {
      ...DEFAULT_TEST_PREFERENCES,
      autoUpscaleEnabled,
    },
  }
  const config = {
    superResolution,
  } as ReaderRuntimeConfigDto
  return {
    config: vi.fn(async () => config),
    updateSuperResolution: vi.fn(async () => superResolution),
  } as unknown as ReaderHttpClient
}
