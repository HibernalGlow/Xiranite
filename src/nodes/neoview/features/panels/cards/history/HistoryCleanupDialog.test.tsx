import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderHttpClient } from "../../../../adapters/reader-http-client"
import HistoryCleanupDialog from "./HistoryCleanupDialog"

afterEach(cleanup)

describe("HistoryCleanupDialog", () => {
  it("[neoview.history.cleanup-gui] confirms the bounded oldest cleanup and publishes its result", async () => {
    const cleanupRecents = vi.fn(async () => ({ deleted: 7 }))
    const onCompleted = vi.fn()
    render(<HistoryCleanupDialog
      open
      client={{ cleanupRecents } as ReaderHttpClient}
      onOpenChange={vi.fn()}
      onCompleted={onCompleted}
    />)

    fireEvent.change(screen.getByRole("spinbutton", { name: "最旧记录数量" }), { target: { value: "7" } })
    const row = screen.getByText("清理最旧记录").closest("div.rounded")!
    fireEvent.click(within(row).getByRole("button", { name: "执行" }))
    expect(await screen.findByRole("alertdialog")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "确认清理" }))

    await waitFor(() => expect(cleanupRecents).toHaveBeenCalledWith({ kind: "oldest", limit: 7 }, expect.any(AbortSignal)))
    await screen.findByText("清理完成，删除 7 条历史记录。")
    expect(onCompleted).toHaveBeenCalledWith({ deleted: 7, message: "清理完成，删除 7 条历史记录。" })
  })

  it("[neoview.history.cleanup-folder-gui] reuses the host directory picker before confirmation", async () => {
    const cleanupRecents = vi.fn(async () => ({ deleted: 2 }))
    render(<HistoryCleanupDialog
      open
      client={{ cleanupRecents } as ReaderHttpClient}
      pickDirectory={vi.fn(async () => "D:/Library")}
      onOpenChange={vi.fn()}
      onCompleted={vi.fn()}
    />)

    fireEvent.click(screen.getByRole("button", { name: "选择历史清理文件夹" }))
    await waitFor(() => expect((screen.getByRole("textbox", { name: "历史清理文件夹路径" }) as HTMLInputElement).value).toBe("D:/Library"))
    const row = screen.getByText("按文件夹清理").closest("div.rounded")!
    fireEvent.click(within(row).getByRole("button", { name: "执行" }))
    fireEvent.click(await screen.findByRole("button", { name: "确认清理" }))

    await waitFor(() => expect(cleanupRecents).toHaveBeenCalledWith({ kind: "folder", path: "D:/Library" }, expect.any(AbortSignal)))
  })

  it("[neoview.history.cleanup-cancel-gui] aborts an in-flight invalid-path cleanup without refreshing", async () => {
    let requestSignal: AbortSignal | undefined
    const cleanupInvalidLibrary = vi.fn((_kind: "recents", signal?: AbortSignal) => new Promise<never>((_resolve, reject) => {
      requestSignal = signal
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true })
    }))
    const onCompleted = vi.fn()
    render(<HistoryCleanupDialog
      open
      client={{ cleanupInvalidLibrary } as ReaderHttpClient}
      onOpenChange={vi.fn()}
      onCompleted={onCompleted}
    />)

    const row = screen.getByText("清理失效路径").closest("div.rounded")!
    fireEvent.click(within(row).getByRole("button", { name: "执行" }))
    fireEvent.click(await screen.findByRole("button", { name: "确认清理" }))
    fireEvent.click(await screen.findByRole("button", { name: "取消清理" }))

    await waitFor(() => expect(requestSignal?.aborted).toBe(true))
    await screen.findByText("清理已取消。")
    expect(onCompleted).not.toHaveBeenCalled()
  })
})
