import { describe, expect, it, vi } from "vitest"

import {
  folderTabReplacementPolicy,
  routeFolderTabActivation,
  routeFolderTabBrowse,
  routeFolderTabNavigation,
} from "./FolderTabNavigationPolicy"

describe("FolderTabNavigationPolicy", () => {
  it("classifies search and EFU workspaces as protected", () => {
    expect(folderTabReplacementPolicy("directory")).toBe("replaceable")
    expect(folderTabReplacementPolicy("search")).toBe("protected")
    expect(folderTabReplacementPolicy("efu")).toBe("protected")
  })

  it("routes browse requests away from protected tabs", () => {
    const replaceCurrent = vi.fn()
    const openInNewTab = vi.fn()

    routeFolderTabBrowse({
      policy: "protected",
      forceNewTab: false,
      path: "C:/history",
      replaceCurrent,
      openInNewTab,
    })

    expect(openInNewTab).toHaveBeenCalledWith("C:/history")
    expect(replaceCurrent).not.toHaveBeenCalled()
  })

  it("keeps ordinary directory tabs replaceable", () => {
    const replaceCurrent = vi.fn()
    const openInNewTab = vi.fn()

    routeFolderTabBrowse({
      policy: "replaceable",
      forceNewTab: false,
      path: "C:/history",
      replaceCurrent,
      openInNewTab,
    })

    expect(replaceCurrent).toHaveBeenCalledWith("C:/history")
    expect(openInNewTab).not.toHaveBeenCalled()
  })

  it("declines library activation and redirects path navigation for protected tabs", () => {
    const activateCurrent = vi.fn()
    const openInNewTab = vi.fn()

    expect(routeFolderTabActivation({
      policy: "protected",
      path: "C:/books/series",
      activateCurrent,
    })).toBe(false)
    expect(activateCurrent).not.toHaveBeenCalled()

    expect(routeFolderTabNavigation({
      policy: "protected",
      navigation: { action: "path", path: "C:/books/other" },
      openInNewTab,
    })).toBe(true)
    expect(openInNewTab).toHaveBeenCalledWith("C:/books/other")

    expect(routeFolderTabNavigation({
      policy: "protected",
      navigation: { action: "refresh" },
      openInNewTab,
    })).toBe(false)
  })
})

