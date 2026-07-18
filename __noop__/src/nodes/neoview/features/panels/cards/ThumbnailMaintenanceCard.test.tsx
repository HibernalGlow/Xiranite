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
})
