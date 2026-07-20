import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderHttpClient, ReaderThumbnailMaintenanceSnapshotDto } from "../../../adapters/reader-http-client"
import ThumbnailMaintenanceCard from "./ThumbnailMaintenanceCard"

afterEach(cleanup)

const SNAPSHOT: ReaderThumbnailMaintenanceSnapshotDto = {
  totalRows: 1_250,
  fileRows: 1_000,
  folderRows: 250,
  blobBytes: 2_097_152,
  emptyBlobs: 3,
  failedRows: 2,
  failuresByReason: { decode: 2 },
  databaseBytes: 1_048_576,
  walBytes: 1_024,
  shmBytes: 512,
  writer: {
    pendingWrites: 4,
    flushing: false,
    committedBatches: 10,
    committedWrites: 20,
    busyRetries: 0,
    failedBatches: 0,
  },
}

describe("ThumbnailMaintenanceCard", () => {
  it("[neoview.thumbnail-maintenance.card] loads aggregate statistics only while explicitly active", async () => {
    const thumbnailMaintenance = vi.fn(async () => SNAPSHOT)
    const client = { thumbnailMaintenance } as unknown as ReaderHttpClient
    const view = render(<ThumbnailMaintenanceCard client={client} disabled={false} panelActive={false} onGoTo={() => {}} />)
    expect(thumbnailMaintenance).not.toHaveBeenCalled()

    view.rerender(<ThumbnailMaintenanceCard client={client} disabled={false} panelActive onGoTo={() => {}} />)
    expect(await screen.findByText("1,250")).toBeTruthy()
    expect(screen.getByText(/Blob 2\.00 MB/)).toBeTruthy()
    expect(screen.getByText("Database 1.00 MB")).toBeTruthy()
    expect(screen.getByText("WAL 1.0 KB")).toBeTruthy()
    expect(screen.getByText("SHM 512 B")).toBeTruthy()
    expect(screen.getByRole("button", { name: "刷新缩略图数据库统计" }).getAttribute("title")).toBe("刷新统计")
    expect(thumbnailMaintenance).toHaveBeenCalledTimes(1)
  })

  it("[neoview.thumbnail-maintenance.card-actions] submits bounded cleanup once and refreshes statistics", async () => {
    const thumbnailMaintenance = vi.fn(async () => SNAPSHOT)
    const cleanupThumbnails = vi.fn(async () => ({
      kind: "invalid" as const,
      scanned: 50,
      deleted: 2,
      unavailableVolumeRowsPreserved: 1,
      wrapped: false,
    }))
    const clearThumbnailFailures = vi.fn(async () => 2)
    const client = { thumbnailMaintenance, cleanupThumbnails, clearThumbnailFailures } as unknown as ReaderHttpClient
    render(<ThumbnailMaintenanceCard client={client} disabled={false} panelActive onGoTo={() => {}} />)
    await screen.findByText("1,250")

    fireEvent.click(screen.getByRole("button", { name: "无效路径" }))
    expect(await screen.findByText("已扫描 50 条，删除 2 条，保留不可用卷 1 条")).toBeTruthy()
    expect(cleanupThumbnails).toHaveBeenCalledTimes(1)
    expect(cleanupThumbnails).toHaveBeenCalledWith({ kind: "invalid", scanLimit: 500, limit: 500 }, expect.any(AbortSignal))
    expect(thumbnailMaintenance).toHaveBeenCalledTimes(2)

    fireEvent.change(screen.getByLabelText("超过"), { target: { value: "60" } })
    fireEvent.click(screen.getByRole("button", { name: "清理过期条目" }))
    await waitFor(() => expect(cleanupThumbnails).toHaveBeenLastCalledWith({
      kind: "expired", days: 60, limit: 500, preserveFolders: true,
    }, expect.any(AbortSignal)))
  })

  it("[neoview.thumbnail-maintenance.current-directory] exposes prewarm, rebuild and scoped cache cleanup", async () => {
    const thumbnailMaintenance = vi.fn(async () => SNAPSHOT)
    const entries = [
      { name: "series", path: "D:/library/series", kind: "directory" as const, readerSupported: true },
      { name: "book.cbz", path: "D:/library/book.cbz", kind: "file" as const, readerSupported: true },
    ]
    const openDirectoryBrowser = vi.fn(async () => ({ sessionId: "maintenance-browser", total: entries.length }))
    const listDirectoryBrowser = vi.fn(async () => ({ entries, total: entries.length }))
    const prewarmLibraryThumbnails = vi.fn(async (items: readonly unknown[]) => ({ total: items.length, completed: items.length, failed: 0 }))
    const closeDirectoryBrowser = vi.fn(async () => undefined)
    const clearThumbnailFolderManifests = vi.fn(async () => 3)
    const cleanupThumbnails = vi.fn(async () => ({ kind: "path-prefix" as const, prefix: "D:/library", deleted: 4 }))
    const client = {
      thumbnailMaintenance,
      openDirectoryBrowser,
      listDirectoryBrowser,
      prewarmLibraryThumbnails,
      closeDirectoryBrowser,
      clearThumbnailFolderManifests,
      cleanupThumbnails,
    } as unknown as ReaderHttpClient
    render(<ThumbnailMaintenanceCard
      client={client}
      disabled={false}
      panelActive
      sourcePath="D:/library/book.cbz"
      browserOriginPath="D:/library"
      onGoTo={() => {}}
    />)
    await screen.findByText("1,250")

    fireEvent.click(screen.getByRole("button", { name: "预热当前目录" }))
    expect(await screen.findByText("已预热 2/2 项")).toBeTruthy()
    expect(openDirectoryBrowser).toHaveBeenLastCalledWith("D:/library", expect.any(AbortSignal), "thumbnail-maintenance", false)
    expect(prewarmLibraryThumbnails).toHaveBeenLastCalledWith(expect.any(Array), { mode: "ensure", concurrency: 2 }, expect.any(AbortSignal))
    expect(closeDirectoryBrowser).toHaveBeenCalledWith("maintenance-browser", false)

    fireEvent.click(screen.getByRole("button", { name: "重建当前目录清单" }))
    expect(await screen.findByText("已清除 3 条代表图清单；已预热 2/2 项")).toBeTruthy()
    expect(clearThumbnailFolderManifests).toHaveBeenLastCalledWith("D:/library", 500, expect.any(AbortSignal))

    fireEvent.click(screen.getByRole("button", { name: "清理当前目录缓存" }))
    expect(await screen.findByText("已删除 4 条当前目录缩略图和 3 条代表图清单（单次上限 500）")).toBeTruthy()
    expect(cleanupThumbnails).toHaveBeenLastCalledWith({ kind: "path-prefix", prefix: "D:/library", limit: 500 }, expect.any(AbortSignal))
  })

  it("[neoview.thumbnail-maintenance.card-actions] preserves a committed cleanup result when statistics refresh fails", async () => {
    const thumbnailMaintenance = vi.fn()
      .mockResolvedValueOnce(SNAPSHOT)
      .mockRejectedValueOnce(new Error("stats unavailable"))
    const cleanupThumbnails = vi.fn(async () => ({
      kind: "empty" as const,
      scanned: 3,
      deleted: 1,
      wrapped: false,
    }))
    const client = { thumbnailMaintenance, cleanupThumbnails } as unknown as ReaderHttpClient
    render(<ThumbnailMaintenanceCard client={client} disabled={false} panelActive onGoTo={() => {}} />)
    await screen.findByText("1,250")

    fireEvent.click(screen.getByRole("button", { name: "空 Blob" }))

    expect(await screen.findByText("已删除 1 条空 Blob 记录；统计刷新失败：缩略图维护失败，请重试")).toBeTruthy()
    expect(screen.queryByText(/^缩略图维护失败/)).toBeNull()
    expect(cleanupThumbnails).toHaveBeenCalledTimes(1)
  })

  it("[neoview.thumbnail-maintenance.card-lifecycle] aborts the active request on unmount and never polls", async () => {
    let requestSignal: AbortSignal | undefined
    const thumbnailMaintenance = vi.fn((signal?: AbortSignal) => {
      requestSignal = signal
      return new Promise<ReaderThumbnailMaintenanceSnapshotDto>(() => {})
    })
    const client = { thumbnailMaintenance } as unknown as ReaderHttpClient
    const view = render(<ThumbnailMaintenanceCard client={client} disabled={false} panelActive onGoTo={() => {}} />)
    await waitFor(() => expect(thumbnailMaintenance).toHaveBeenCalledTimes(1))
    view.unmount()
    expect(requestSignal?.aborted).toBe(true)
    expect(thumbnailMaintenance).toHaveBeenCalledTimes(1)
  })

  it("[neoview.thumbnail-maintenance.card-lifecycle] aborts a cleanup when its Panel becomes inactive", async () => {
    let mutationSignal: AbortSignal | undefined
    const thumbnailMaintenance = vi.fn(async () => SNAPSHOT)
    const cleanupThumbnails = vi.fn((_command, signal?: AbortSignal) => {
      mutationSignal = signal
      return new Promise<never>(() => {})
    })
    const client = { thumbnailMaintenance, cleanupThumbnails } as unknown as ReaderHttpClient
    const view = render(<ThumbnailMaintenanceCard client={client} disabled={false} panelActive onGoTo={() => {}} />)
    await screen.findByText("1,250")

    fireEvent.click(screen.getByRole("button", { name: "无效路径" }))
    await waitFor(() => expect(cleanupThumbnails).toHaveBeenCalledTimes(1))
    view.rerender(<ThumbnailMaintenanceCard client={client} disabled={false} panelActive={false} onGoTo={() => {}} />)

    expect(mutationSignal?.aborted).toBe(true)
    expect(thumbnailMaintenance).toHaveBeenCalledTimes(1)
  })

  it("[neoview.thumbnail-maintenance.card] renders a measured empty database as zero bytes", async () => {
    const thumbnailMaintenance = vi.fn(async () => ({
      ...SNAPSHOT,
      totalRows: 0,
      fileRows: 0,
      folderRows: 0,
      blobBytes: 0,
      emptyBlobs: 0,
      failedRows: 0,
      failuresByReason: {},
      databaseBytes: 0,
      walBytes: 0,
      shmBytes: 0,
    }))
    render(<ThumbnailMaintenanceCard client={{ thumbnailMaintenance } as unknown as ReaderHttpClient} disabled={false} panelActive onGoTo={() => {}} />)

    expect(await screen.findByText("0 B")).toBeTruthy()
  })

  it("[neoview.thumbnail-maintenance.cancel-ui] cancels the active operation without replacing the last snapshot", async () => {
    let mutationSignal: AbortSignal | undefined
    const thumbnailMaintenance = vi.fn(async () => SNAPSHOT)
    const cleanupThumbnails = vi.fn((_command, signal?: AbortSignal) => {
      mutationSignal = signal
      return new Promise<never>(() => {})
    })
    const client = { thumbnailMaintenance, cleanupThumbnails } as unknown as ReaderHttpClient
    render(<ThumbnailMaintenanceCard client={client} disabled={false} panelActive onGoTo={() => {}} />)
    await screen.findByText("1,250")

    fireEvent.click(screen.getByTestId("thumbnail-maintenance-invalid"))
    await waitFor(() => expect(cleanupThumbnails).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByTestId("thumbnail-maintenance-cancel"))

    expect(mutationSignal?.aborted).toBe(true)
    expect(screen.getByText("1,250")).toBeTruthy()
    expect(screen.getByRole("status")).toBeTruthy()
    expect(screen.queryByTestId("thumbnail-maintenance-cancel")).toBeNull()
  })

  it("[neoview.thumbnail-maintenance.card-lifecycle] clears busy state when disabled aborts an operation", async () => {
    let mutationSignal: AbortSignal | undefined
    const thumbnailMaintenance = vi.fn(async () => SNAPSHOT)
    const cleanupThumbnails = vi.fn((_command, signal?: AbortSignal) => {
      mutationSignal = signal
      return new Promise<never>(() => {})
    })
    const client = { thumbnailMaintenance, cleanupThumbnails } as unknown as ReaderHttpClient
    const view = render(<ThumbnailMaintenanceCard client={client} disabled={false} panelActive onGoTo={() => {}} />)
    await screen.findByText("1,250")

    fireEvent.click(screen.getByTestId("thumbnail-maintenance-invalid"))
    await waitFor(() => expect(cleanupThumbnails).toHaveBeenCalledTimes(1))
    view.rerender(<ThumbnailMaintenanceCard client={client} disabled panelActive onGoTo={() => {}} />)

    expect(mutationSignal?.aborted).toBe(true)
    expect(screen.queryByTestId("thumbnail-maintenance-cancel")).toBeNull()

    view.rerender(<ThumbnailMaintenanceCard client={client} disabled={false} panelActive onGoTo={() => {}} />)
    await waitFor(() => expect(thumbnailMaintenance).toHaveBeenCalledTimes(2))
    expect(screen.getByTestId("thumbnail-maintenance-invalid").hasAttribute("disabled")).toBe(false)
  })
})
