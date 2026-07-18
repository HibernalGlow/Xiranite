import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderHttpClient } from "../../../../adapters/reader-http-client"
import FolderFavoriteTagPanel from "./FolderFavoriteTagPanel"

afterEach(cleanup)

describe("FolderFavoriteTagPanel", () => {
  it("[neoview.folder.favorite-tags-panel] preserves legacy pin, close, modifier and resize behavior", async () => {
    const onTag = vi.fn()
    const onClose = vi.fn()
    render(
      <FolderFavoriteTagPanel
        client={{ suggestDirectoryEmmTags: vi.fn(async () => [
          { category: "artist", tag: "alice", favorite: true, translatedTag: "爱丽丝" },
          { category: "language", tag: "chinese", favorite: false },
        ]) } as unknown as ReaderHttpClient}
        includeTags={new Set()}
        excludeTags={new Set()}
        onTag={onTag}
        onClose={onClose}
      />,
    )

    const artist = await screen.findByRole("button", { name: "选择标签 artist:alice" })
    fireEvent.click(artist)
    fireEvent.click(artist, { ctrlKey: true })
    fireEvent.contextMenu(artist)
    expect(onTag.mock.calls.map((call) => call[1])).toEqual(["replace-include", "toggle-include", "toggle-exclude"])

    fireEvent.click(screen.getByRole("button", { name: "固定面板" }))
    fireEvent.pointerDown(document.body)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "取消固定" }))
    fireEvent.pointerDown(document.body)
    expect(onClose).toHaveBeenCalledOnce()

    const panel = document.querySelector<HTMLElement>('[data-neoview-favorite-tag-panel="true"]')!
    const separator = screen.getByRole("separator", { name: "调整收藏标签面板高度" })
    fireEvent.pointerDown(separator, { pointerId: 1, clientY: 300 })
    fireEvent.pointerMove(separator, { pointerId: 1, clientY: 700 })
    fireEvent.pointerUp(separator, { pointerId: 1, clientY: 700 })
    await waitFor(() => expect(panel.style.height).toBe("500px"))
    expect(separator.getAttribute("aria-valuenow")).toBe("500")
  })
})
