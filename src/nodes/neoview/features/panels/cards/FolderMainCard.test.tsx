import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { ReaderDirectoryPageDto, ReaderHttpClient } from "../../../adapters/reader-http-client"
import FolderMainCard from "./FolderMainCard"

describe("FolderMainCard", () => {
  it("[neoview.browser.card] lazily opens, navigates, and disposes its shared browser session", async () => {
    const opened = page({ path: "C:/books", parentPath: "C:/" })
    const parent = page({ path: "C:/", parentPath: undefined, generation: 2 })
    const openDirectoryBrowser = vi.fn(async () => opened)
    const navigateDirectoryBrowser = vi.fn(async () => parent)
    const closeDirectoryBrowser = vi.fn(async () => undefined)
    const client = { openDirectoryBrowser, navigateDirectoryBrowser, closeDirectoryBrowser } as ReaderHttpClient
    const view = render(
      <FolderMainCard client={client} disabled={false} sourcePath="C:/books/page1.png" onOpen={vi.fn()} onGoTo={vi.fn()} />,
    )
    await waitFor(() => expect(openDirectoryBrowser).toHaveBeenCalledWith("C:/books/page1.png", expect.any(AbortSignal)))
    await waitFor(() => expect(screen.getByDisplayValue("C:/books")).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: "上级" }))
    await waitFor(() => expect(navigateDirectoryBrowser).toHaveBeenCalledWith("browser-1", { action: "up" }, expect.any(AbortSignal)))
    view.unmount()
    expect(closeDirectoryBrowser).toHaveBeenCalledWith("browser-1")
  })
})

function page(overrides: Partial<ReaderDirectoryPageDto>): ReaderDirectoryPageDto {
  return {
    sessionId: "browser-1",
    path: "C:/books",
    entries: [],
    cursor: 0,
    total: 0,
    canGoBack: false,
    canGoForward: false,
    generation: 1,
    ...overrides,
  }
}
