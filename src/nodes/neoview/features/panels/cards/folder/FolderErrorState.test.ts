import { describe, expect, it } from "vitest"

import {
  clearFolderErrorState,
  createFolderErrorState,
  shouldRetainDirectoryContent,
} from "./FolderErrorState"

describe("FolderErrorState", () => {
  it("[neoview.folder.error-navigation] keeps the last good directory while navigation can be retried", () => {
    const state = createFolderErrorState(
      new Error("ENOENT: no such file or directory, scandir 'E:'"),
      "navigate",
    )

    expect(state).toMatchObject({
      operation: "navigate",
      retryable: true,
      retainLastGoodContent: true,
    })
    expect(state.message).not.toContain("E:")
    expect(shouldRetainDirectoryContent(state)).toBe(true)
  })

  it("[neoview.folder.error-open] does not claim stale content when the initial open has no catalog", () => {
    const state = createFolderErrorState(new Error("access denied"), "open")

    expect(state).toMatchObject({
      operation: "open",
      retryable: true,
      retainLastGoodContent: false,
      message: "没有权限访问此目录。",
    })
    expect(shouldRetainDirectoryContent(state)).toBe(false)
  })

  it("[neoview.folder.error-clear] clears transient errors without changing content state", () => {
    expect(clearFolderErrorState()).toBeUndefined()
    expect(shouldRetainDirectoryContent(undefined)).toBe(false)
  })
})
