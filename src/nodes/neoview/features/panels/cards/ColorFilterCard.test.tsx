import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createReaderColorFilterStore } from "../../color-filter/ReaderColorFilterStore"
import DockedColorFilterCard, { ColorFilterCard } from "./ColorFilterCard"

afterEach(cleanup)

describe("ColorFilterCard", () => {
  it("keeps the legacy controls available without a book", async () => {
    const store = createReaderColorFilterStore({ persist: async (settings) => settings })
    render(<ColorFilterCard store={store} />)
    expect(screen.getAllByRole("slider")).toHaveLength(5)
    fireEvent.click(screen.getByText("着色"))
    expect(await screen.findByLabelText("着色预设")).toBeTruthy()
    expect(screen.getByText("仅黑白图像")).toBeTruthy()
  })

  it("previews a slider and commits once at pointer end", async () => {
    const persist = vi.fn(async (settings) => settings)
    const store = createReaderColorFilterStore({ persist })
    render(<ColorFilterCard store={store} />)
    const brightness = screen.getByRole("slider", { name: "亮度" })
    fireEvent.change(brightness, { target: { value: "125" } })
    expect(store.getSnapshot().brightness).toBe(125)
    expect(persist).not.toHaveBeenCalled()
    fireEvent.pointerUp(brightness, { pointerId: 1 })
    await waitFor(() => expect(persist).toHaveBeenCalledOnce())
  })

  it("stays interactive while a Reader navigation is busy", () => {
    const store = createReaderColorFilterStore({ persist: async (settings) => settings })
    render(<DockedColorFilterCard colorFilter={store} disabled client={{} as never} onGoTo={() => undefined} />)
    expect(screen.getByRole("slider", { name: "亮度" }).hasAttribute("disabled")).toBe(false)
  })
})
