import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { ReaderFilePresentationSizeControl } from "./ReaderFilePresentationSizeControl"
import { ReaderFilePresentationMoreMenu } from "./ReaderFilePresentationMoreMenu"

describe("ReaderFilePresentationSizeControl", () => {
  it("restores File Card preview and persisted size to the built-in default", async () => {
    const onPreview = vi.fn()
    const onCommit = vi.fn()
    render(
      <ReaderFilePresentationMoreMenu
        presentation={{
          viewMode: "cover-grid",
          contentWidthPercent: 35,
          thumbnailWidthPercent: 28,
          bannerWidthPercent: 50,
        }}
        resetMode="default"
        onPreview={onPreview}
        onCommit={onCommit}
      />,
    )

    fireEvent.pointerDown(screen.getByRole("button", { name: "更多" }), { button: 0, ctrlKey: false })
    fireEvent.click(await screen.findByRole("button", { name: "恢复默认的缩略图宽度" }))
    expect(onPreview).toHaveBeenCalledWith("thumbnailWidthPercent", 20)
    expect(onCommit).toHaveBeenCalledWith("thumbnailWidthPercent", 20)
  })

  it("keeps inherited History and Bookmark values non-resettable", () => {
    render(
      <ReaderFilePresentationSizeControl
        presentation={{
          viewMode: "cover-grid",
          contentWidthPercent: 35,
          thumbnailWidthPercent: 28,
          bannerWidthPercent: 50,
        }}
        overrides={{}}
        onPreview={vi.fn()}
        onCommit={vi.fn()}
        onReset={vi.fn()}
      />,
    )

    expect(screen.getByRole("button", { name: "恢复继承的缩略图宽度" }).hasAttribute("disabled")).toBe(true)
  })
})
