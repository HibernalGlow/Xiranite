import { describe, expect, it } from "vitest"

import { formatDate, formatTimeSource } from "./reader-metadata-format"

describe("reader metadata formatting", () => {
  it("[neoview.time-information.format] uses local time and degrades invalid values", () => {
    const timestamp = 1_704_164_646_000
    expect(formatDate(timestamp)).toBe(new Date(timestamp).toLocaleString("zh-CN"))
    expect(formatDate()).toBe("—")
    expect(formatDate(Number.NaN)).toBe("—")
    expect(formatDate(Number.POSITIVE_INFINITY)).toBe("—")
    expect(formatTimeSource("filesystem")).toBe("文件系统")
    expect(formatTimeSource("archive-entry")).toBe("压缩包条目")
    expect(formatTimeSource("book-source")).toBe("书籍源文件")
    expect(formatTimeSource()).toBe("未知")
  })
})
