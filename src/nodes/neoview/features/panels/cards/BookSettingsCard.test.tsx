import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { BookSettingsCard, BOOK_SETTINGS_CAPABILITY_AUDIT } from "./BookSettingsCard"

afterEach(cleanup)

describe("BookSettingsCard", () => {
  it("[neoview.card.book-settings-page-mode] delegates the supported session page-mode update", () => {
    const onPageModeChange = vi.fn()
    render(
      <BookSettingsCard
        bookName="example.cbz"
        pageMode="single"
        readingDirection="left-to-right"
        onPageModeChange={onPageModeChange}
        onReadingDirectionChange={vi.fn()}
      />,
    )

    expect(screen.getByText("example.cbz")).toBeTruthy()
    expect(screen.getByRole("button", { name: "单页" }).getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(screen.getByRole("button", { name: "双页" }))
    expect(onPageModeChange).toHaveBeenCalledOnce()
    expect(onPageModeChange).toHaveBeenCalledWith("double")
  })

  it("[neoview.card.book-settings-direction] applies current-session direction and preserves the confirmed value on failure", async () => {
    const onReadingDirectionChange = vi.fn().mockRejectedValue(new Error("方向更新失败"))
    render(
      <BookSettingsCard
        bookName="example.cbz"
        pageMode="double"
        readingDirection="left-to-right"
        onPageModeChange={vi.fn()}
        onReadingDirectionChange={onReadingDirectionChange}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "右→左" }))
    expect(onReadingDirectionChange).toHaveBeenCalledWith("right-to-left")
    expect((await screen.findByRole("alert")).textContent).toContain("方向更新失败")
    expect(screen.getByRole("button", { name: "左→右" }).getAttribute("aria-pressed")).toBe("true")
  })

  it("[neoview.card.book-settings-contract] does not present unsupported per-book controls", () => {
    render(
      <BookSettingsCard
        bookName="example.cbz"
        pageMode="double"
        readingDirection="right-to-left"
        disabled
        onPageModeChange={vi.fn()}
        onReadingDirectionChange={vi.fn()}
      />,
    )

    expect(screen.queryByText("收藏")).toBeNull()
    expect(screen.queryByText("评分")).toBeNull()
    expect(screen.getByText("阅读方向")).toBeTruthy()
    expect(screen.queryByText("横版本子")).toBeNull()
    expect((screen.getByRole("button", { name: "单页" }) as HTMLButtonElement).disabled).toBe(true)
    expect(BOOK_SETTINGS_CAPABILITY_AUDIT.map(({ id, status }) => [id, status])).toEqual([
      ["favorite", "blocked"],
      ["rating", "blocked"],
      ["reading-direction", "supported-session"],
      ["page-mode", "supported"],
      ["horizontal-book", "blocked"],
    ])
  })
})
