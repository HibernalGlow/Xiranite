// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, test, vi } from "vitest"

import type { ReaderShellControlPort } from "./ReaderShellControlPort"
import { createReaderShellControlStore } from "./ReaderShellControlStore"
import { ReaderWindowBar } from "./ReaderWindowBar"

afterEach(cleanup)

function createControl(): ReaderShellControlPort {
  const store = createReaderShellControlStore()
  return {
    store,
    requestOpen: store.requestOpen,
    setPinned: store.setPinned,
    cycleLock: store.cycleLock,
    setLock: store.setLock,
    setFloating: store.setFloating,
    setTriggerSize: () => undefined,
    reset: () => undefined,
    persist: () => undefined,
  }
}

describe("ReaderWindowBar", () => {
  test("places pin and settings before window caption controls on the right", () => {
    const onOpenSettings = vi.fn()
    render(
      <ReaderWindowBar
        control={createControl()}
        onOpenSettings={onOpenSettings}
        windowControls={<button type="button" aria-label="关闭窗口">×</button>}
      />,
    )

    const bar = document.querySelector('[data-reader-window-bar="true"]')
    expect(bar).toBeTruthy()
    const rightCluster = bar!.querySelector(".justify-self-end")
    expect(rightCluster).toBeTruthy()
    const labels = Array.from(rightCluster!.querySelectorAll("button")).map((button) => button.getAttribute("aria-label"))
    expect(labels).toEqual(["固定顶栏", "打开 NeoView 设置", "关闭窗口"])
    expect(bar!.querySelector(".justify-self-center")).toBeNull()

    fireEvent.click(screen.getByLabelText("打开 NeoView 设置"))
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
  })
})
