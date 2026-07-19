import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createReaderPageTransitionStore } from "../../page-transition/ReaderPageTransitionStore"
import DockedPageTransitionCard, { PageTransitionCard } from "./PageTransitionCard"

afterEach(cleanup)

describe("PageTransitionCard", () => {
  it("keeps the animation switch available without a book", () => {
    const store = createReaderPageTransitionStore({ persist: async (settings) => settings })
    render(<PageTransitionCard store={store} />)
    expect(screen.getByRole("checkbox", { name: "启用翻页动画" }).hasAttribute("disabled")).toBe(false)
    fireEvent.click(screen.getByRole("checkbox", { name: "启用翻页动画" }))
    expect(screen.getByLabelText("动画类型")).toBeTruthy()
  })

  it("previews duration and commits once at interaction end", async () => {
    const persist = vi.fn(async (settings) => settings)
    const store = createReaderPageTransitionStore({ persist })
    store.preview({ enabled: true })
    render(<PageTransitionCard store={store} />)
    const slider = screen.getByRole("slider", { name: "动画时长" })
    fireEvent.change(slider, { target: { value: "240" } })
    expect(persist).not.toHaveBeenCalled()
    fireEvent.pointerUp(slider, { pointerId: 1 })
    await waitFor(() => expect(persist).toHaveBeenCalledOnce())
    expect(persist.mock.calls[0]?.[0].duration).toBe(240)
  })

  it("does not disable the switch when navigation is busy", () => {
    const store = createReaderPageTransitionStore({ persist: async (settings) => settings })
    render(<DockedPageTransitionCard pageTransition={store} disabled client={{} as never} onGoTo={() => undefined} />)
    expect(screen.getByRole("checkbox", { name: "启用翻页动画" }).hasAttribute("disabled")).toBe(false)
  })
})
