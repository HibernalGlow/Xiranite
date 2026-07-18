import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import FolderTypeFilterBar from "./FolderTypeFilterBar"

describe("FolderTypeFilterBar", () => {
  it("[neoview.folder.filter-ui] preserves the legacy inline option order and emits the canonical directory value", () => {
    const onChange = vi.fn()
    render(
      <FolderTypeFilterBar
        value="archive"
        options={["all", "archive", "directory", "video"]}
        disabled={false}
        onChange={onChange}
      />,
    )

    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["全部", "压缩包", "文件夹", "视频"])
    expect(screen.getByRole("button", { name: "压缩包" }).getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(screen.getByRole("button", { name: "文件夹" }))
    expect(onChange).toHaveBeenCalledWith("directory")
  })
})
