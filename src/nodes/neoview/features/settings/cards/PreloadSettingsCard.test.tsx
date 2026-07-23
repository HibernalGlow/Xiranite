import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PreloadSettingsCard } from "./PreloadSettingsCard"

afterEach(cleanup)

describe("PreloadSettingsCard", () => {
  it("[neoview.preload.settings] commits the bounded candidate budget only on explicit draft completion", async () => {
    const onChange = vi.fn(async (patch) => patch)
    render(<PreloadSettingsCard preload={{ maxCandidatePages: 4, browserPredecodeEnabled: true, browserPredecodePages: 1 }} onChange={onChange} />)
    const input = screen.getByRole("spinbutton", { name: "预读候选页上限" })
    fireEvent.change(input, { target: { value: "12" } })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.blur(input)
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ maxCandidatePages: 12 }))
  })

  it("clamps drafts and restores the confirmed value after a failed write", async () => {
    const onChange = vi.fn().mockRejectedValue(new Error("disk unavailable"))
    render(<PreloadSettingsCard preload={{ maxCandidatePages: 4, browserPredecodeEnabled: true, browserPredecodePages: 1 }} onChange={onChange} />)
    const input = screen.getByRole("spinbutton", { name: "预读候选页上限" }) as HTMLInputElement
    fireEvent.change(input, { target: { value: "99" } })
    fireEvent.blur(input)
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ maxCandidatePages: 32 }))
    expect((await screen.findByRole("alert")).textContent).toContain("disk unavailable")
    expect(input.value).toBe("4")
  })

  it("commits browser predecode as an independent toggle", async () => {
    const onChange = vi.fn(async (patch) => ({ maxCandidatePages: 4, browserPredecodeEnabled: patch.browserPredecodeEnabled ?? true, browserPredecodePages: 1 }))
    render(<PreloadSettingsCard preload={{ maxCandidatePages: 4, browserPredecodeEnabled: true, browserPredecodePages: 1 }} onChange={onChange} />)
    fireEvent.click(screen.getByRole("switch", { name: "相邻页预解码" }))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ browserPredecodeEnabled: false }))
  })

  it("commits the browser predecode page limit independently", async () => {
    const onChange = vi.fn(async () => ({ maxCandidatePages: 4, browserPredecodeEnabled: true, browserPredecodePages: 3 }))
    render(<PreloadSettingsCard preload={{ maxCandidatePages: 4, browserPredecodeEnabled: true, browserPredecodePages: 1 }} onChange={onChange} />)
    const input = screen.getByRole("spinbutton", { name: "相邻页预解码数量" })
    fireEvent.change(input, { target: { value: "3" } })
    fireEvent.blur(input)
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ browserPredecodePages: 3 }))
  })
})
