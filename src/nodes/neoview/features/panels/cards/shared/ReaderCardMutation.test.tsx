import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ReaderCardSaveFeedback, useReaderCardMutation } from "./ReaderCardMutation"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("useReaderCardMutation", () => {
  it("keeps a newer successful save when an older request fails late", async () => {
    const first = deferred<void>()
    const second = deferred<void>()
    render(<Harness first={() => first.promise} second={() => second.promise} />)

    fireEvent.click(screen.getByRole("button", { name: "first" }))
    fireEvent.click(screen.getByRole("button", { name: "second" }))
    await act(async () => second.resolve())
    await waitFor(() => expect(screen.getByText("已保存", { exact: true })).toBeTruthy())

    await act(async () => first.reject(new Error("stale failure")))
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.getByText("已保存", { exact: true })).toBeTruthy()
  })

  it("ignores completion after unmount", async () => {
    const operation = deferred<void>()
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const view = render(<Harness first={() => operation.promise} second={async () => undefined} />)
    fireEvent.click(screen.getByRole("button", { name: "first" }))

    view.unmount()
    await act(async () => operation.resolve())

    expect(consoleError).not.toHaveBeenCalled()
  })

  it("retries the failed operation and reports the recovered save", async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValueOnce(undefined)
    render(<Harness first={operation} second={async () => undefined} />)

    fireEvent.click(screen.getByRole("button", { name: "first" }))
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("保存失败：disk full")
    expect(alert.className).not.toContain("rounded")
    fireEvent.click(screen.getByRole("button", { name: "重试" }))

    await waitFor(() => expect(screen.getByText("已保存", { exact: true })).toBeTruthy())
    expect(operation).toHaveBeenCalledTimes(2)
  })
})

function Harness({ first, second }: {
  first(): Promise<void>
  second(): Promise<void>
}) {
  const mutation = useReaderCardMutation()
  return (
    <div>
      <button type="button" onClick={() => mutation.run(first)}>first</button>
      <button type="button" onClick={() => mutation.run(second)}>second</button>
      <ReaderCardSaveFeedback state={mutation.state} onRetry={mutation.retry} />
    </div>
  )
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
