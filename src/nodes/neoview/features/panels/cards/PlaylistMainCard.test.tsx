import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { ReaderHttpClient } from "../../../adapters/reader-http-client"
import PlaylistMainCard from "./PlaylistMainCard"

const playlist = { id: "queue", name: "Queue", createdAt: 1, updatedAt: 1 }
const entry = { id: "book", playlistId: "queue", name: "Book", source: { kind: "archive" as const, path: "D:/books/book.cbz" }, position: 0, createdAt: 1 }
function client(): ReaderHttpClient {
  return { listPlaylists: vi.fn(async () => [playlist]), savePlaylist: vi.fn(async (value) => ({ ...playlist, id: value.name.toLowerCase(), name: value.name })), removePlaylist: vi.fn(async () => undefined), listPlaylistEntries: vi.fn(async () => [entry]), appendPlaylistEntries: vi.fn(async (_id, values) => values.map((value, index) => ({ ...entry, id: `added-${index}`, name: value.name, source: value.source, position: index + 1 }))), removePlaylistEntries: vi.fn(async () => 1), reorderPlaylistEntries: vi.fn(async () => undefined) } as ReaderHttpClient
}
describe("PlaylistMainCard", () => {
  it("stays idle while inactive, then loads and mutates the shared playlist service", async () => {
    const api = client(), onOpen = vi.fn()
    const view = render(<PlaylistMainCard client={api} disabled={false} panelActive={false} onOpen={onOpen} onGoTo={vi.fn()}/>)
    expect(api.listPlaylists).not.toHaveBeenCalled()
    view.rerender(<PlaylistMainCard client={api} disabled={false} panelActive onOpen={onOpen} onGoTo={vi.fn()}/>)
    await screen.findByText("Queue")
    await screen.findByText("Book")
    fireEvent.click(screen.getByLabelText("打开 Book")); expect(onOpen).toHaveBeenCalledWith("D:/books/book.cbz")
    fireEvent.change(screen.getByLabelText("添加播放列表路径"), { target: { value: "D:/books/next.cbz" } }); fireEvent.click(screen.getByText("添加"))
    await waitFor(() => expect(api.appendPlaylistEntries).toHaveBeenCalled())
    fireEvent.click(screen.getByLabelText("移除 Book")); await waitFor(() => expect(api.removePlaylistEntries).toHaveBeenCalledWith("queue", ["book"]))
  })
})
