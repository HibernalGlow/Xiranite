import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import FolderDeleteButton from "./FolderDeleteButton"

describe("FolderDeleteButton", () => {
  it("[neoview.folder.delete-mode-button] emits the selected strategy without opening the item", () => {
    const opened = vi.fn()
    const host = render(
      <div onClick={opened}>
        <FolderDeleteButton
          entry={{ index: 3, path: "D:/books/old.cbz", name: "old.cbz", kind: "file", readerSupported: true }}
          strategy="permanent"
        />
      </div>,
    )
    const requested = vi.fn()
    host.container.addEventListener("neoview-folder-delete-request", requested)

    fireEvent.click(screen.getByRole("button", { name: "永久删除：old.cbz" }))

    expect(opened).not.toHaveBeenCalled()
    expect(requested).toHaveBeenCalledOnce()
    expect((requested.mock.calls[0]![0] as CustomEvent).detail).toEqual(expect.objectContaining({
      index: 3,
      path: "D:/books/old.cbz",
      strategy: "permanent",
    }))
  })
})
