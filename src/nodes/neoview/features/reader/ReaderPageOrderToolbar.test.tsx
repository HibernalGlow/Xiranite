import { fireEvent, render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { ReaderPageOrderToolbar } from "./ReaderPageOrderToolbar"

describe("ReaderPageOrderToolbar", () => {
  it("[neoview.toolbar.sort] preserves sort direction, media toggle, and per-control locks", () => {
    const onChange = vi.fn()
    const onLockChange = vi.fn()
    const view = render(<ReaderPageOrderToolbar
      order={{ sortMode: "fileName", mediaPriority: "videoFirst" }}
      lockedSortMode={null}
      lockedMediaPriority={null}
      onChange={onChange}
      onLockChange={onLockChange}
    />)

    fireEvent.click(view.getByRole("button", { name: "文件名" }))
    expect(onChange).toHaveBeenLastCalledWith({ sortMode: "fileNameDescending" })
    fireEvent.click(view.getByRole("button", { name: "视频优先" }))
    expect(onChange).toHaveBeenLastCalledWith({ mediaPriority: "none" })
    fireEvent.contextMenu(view.getByRole("button", { name: "图片优先" }))
    expect(onLockChange).toHaveBeenLastCalledWith({ lockedSortMode: null, lockedMediaPriority: "imageFirst" })
    fireEvent.contextMenu(view.getByRole("button", { name: "修改时间" }))
    expect(onLockChange).toHaveBeenLastCalledWith({ lockedSortMode: "timeStamp", lockedMediaPriority: null })
  })

  it("[neoview.toolbar.sort] locks and clears both current settings from the total lock", () => {
    const onLockChange = vi.fn()
    const props = { order: { sortMode: "fileSizeDescending" as const, mediaPriority: "imageFirst" as const }, onChange: vi.fn(), onLockChange }
    const view = render(<ReaderPageOrderToolbar {...props} lockedSortMode={null} lockedMediaPriority={null} />)
    fireEvent.click(view.container.querySelector('[aria-label="锁定页面排序"]')!)
    expect(onLockChange).toHaveBeenLastCalledWith({ lockedSortMode: "fileSizeDescending", lockedMediaPriority: "imageFirst" })
    view.rerender(<ReaderPageOrderToolbar {...props} lockedSortMode="fileSizeDescending" lockedMediaPriority="imageFirst" />)
    fireEvent.click(view.container.querySelector('[aria-label="解锁页面排序"]')!)
    expect(onLockChange).toHaveBeenLastCalledWith({ lockedSortMode: null, lockedMediaPriority: null })
  })
})
