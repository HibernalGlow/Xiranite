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

  it("[neoview.progressive-upscale.settings] persists the source switches and bounded select values", async () => {
    const client = clientFixture(true)
    render(<ProgressiveUpscaleCard client={client} disabled={false} />)
    await waitFor(() => expect(screen.getByRole("switch", { name: "递进超分" })).toBeTruthy())

    fireEvent.click(screen.getByRole("switch", { name: "递进超分" }))
    await waitFor(() => expect(client.updateSuperResolution).toHaveBeenCalledWith({ superResolution: { preferences: { progressiveEnabled: true } } }))

    fireEvent.change(screen.getByRole("combobox", { name: "预加载页数" }), { target: { value: "10" } })
    await waitFor(() => expect(client.updateSuperResolution).toHaveBeenCalledWith({ superResolution: { preferences: { preloadPages: 10 } } }))
  })
})

function clientFixture(autoUpscaleEnabled = false): ReaderHttpClient {
  const superResolution: ReaderSuperResolutionConfigDto = {
    provider: "opencomic-system",
    preferences: {
      autoUpscaleEnabled,
      preUpscaleEnabled: true,
      preloadPages: 3,
      backgroundConcurrency: 2,
      progressiveEnabled: false,
      progressiveDwellTimeMs: 3_000,
      progressiveMaxPages: 20,
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
