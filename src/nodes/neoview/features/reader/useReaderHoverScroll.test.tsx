import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useRef } from "react"

import { useReaderHoverScroll } from "./useReaderHoverScroll"

let nextFrameId = 0
let frames = new Map<number, FrameRequestCallback>()

beforeEach(() => {
  nextFrameId = 0
  frames = new Map()
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    const id = ++nextFrameId
    frames.set(id, callback)
    return id
  }))
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => frames.delete(id)))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("useReaderHoverScroll", () => {
  it("[neoview.viewer.hover-scroll-runtime] scrolls through one native RAF without React frame state and cleans up on page change", () => {
    let renders = 0
    const view = render(<Harness enabled speed={2} pageKey={0} onRender={() => { renders += 1 }} />)
    const viewport = view.getByTestId("viewport")
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 300 },
      scrollWidth: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 1_800 },
    })
    viewport.getBoundingClientRect = vi.fn(() => ({ x: 0, y: 0, left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300, toJSON: () => ({}) }))
    view.rerender(<Harness enabled speed={2} pageKey={1} onRender={() => { renders += 1 }} />)
    const rendersBeforeAnimation = renders

    fireEvent.pointerMove(viewport, { clientX: 200, clientY: 285 })
    runAnimationFrames(8)
    expect(viewport.scrollTop).toBeGreaterThan(0)
    expect(renders).toBe(rendersBeforeAnimation)
    expect(vi.mocked(requestAnimationFrame).mock.calls.length).toBeGreaterThan(1)

    view.rerender(<Harness enabled speed={2} pageKey={2} onRender={() => { renders += 1 }} />)
    expect(frames.size).toBe(0)
    expect(cancelAnimationFrame).toHaveBeenCalled()
  })

  it("does not schedule animation work while disabled", () => {
    const view = render(<Harness enabled={false} speed={2} pageKey={0} />)
    fireEvent.pointerMove(view.getByTestId("viewport"), { clientX: 10, clientY: 10 })
    expect(requestAnimationFrame).not.toHaveBeenCalled()
  })
})

function Harness({ enabled, speed, pageKey, onRender }: { enabled: boolean; speed: number; pageKey: number; onRender?: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  onRender?.()
  useReaderHoverScroll(ref, { enabled, speed, pageKey })
  return <div ref={ref} data-testid="viewport" />
}

function runAnimationFrames(limit: number) {
  for (let index = 0; index < limit; index += 1) {
    const entry = frames.entries().next().value as [number, FrameRequestCallback] | undefined
    if (!entry) return
    frames.delete(entry[0])
    act(() => entry[1](index * 16))
  }
}
