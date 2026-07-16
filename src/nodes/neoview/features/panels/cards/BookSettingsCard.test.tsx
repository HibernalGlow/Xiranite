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
        onPageModeChange={onPageModeChange}
      />,
    )

    expect(screen.getByText("example.cbz")).toBeTruthy()
    expect(screen.getByRole("button", { name: "单页" }).getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(screen.getByRole("button", { name: "双页" }))
    expect(onPageModeChange).toHaveBeenCalledOnce()
    expect(onPageModeChange).toHaveBeenCalledWith("double")
  })

  it("[neoview.card.book-settings-contract] does not present unsupported per-book controls", () => {
    render(
      <BookSettingsCard
        bookName="example.cbz"
        pageMode="double"
        disabled
        onPageModeChange={vi.fn()}
      />,
    )

    expect(screen.queryByText("收藏")).toBeNull()
    expect(screen.queryByText("评分")).toBeNull()
    expect(screen.queryByText("阅读方向")).toBeNull()
    expect(screen.queryByText("横版本子")).toBeNull()
    expect((screen.getByRole("button", { name: "单页" }) as HTMLButtonElement).disabled).toBe(true)
    expect(BOOK_SETTINGS_CAPABILITY_AUDIT.map(({ id, status }) => [id, status])).toEqual([
      ["favorite", "blocked"],
      ["rating", "blocked"],
      ["reading-direction", "blocked"],
      ["page-mode", "supported"],
      ["horizontal-book", "blocked"],
    ])
  })
})
