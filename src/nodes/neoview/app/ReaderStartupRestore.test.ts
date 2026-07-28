import { describe, expect, it } from "vitest"

import type { ReaderStartupStateDto } from "../adapters/reader-http-client"
import { readerStartupRestorePath } from "./ReaderStartupRestore"

const startupState: ReaderStartupStateDto = {
  lastFolder: { path: "D:/books", updatedAt: 1 },
  lastBook: {
    bookId: "latest-book",
    source: { kind: "archive", path: "D:/books/latest.cbz" },
    displayName: "latest.cbz",
    pageIndex: 3,
    pageCount: 12,
    updatedAt: 2,
  },
}

describe("readerStartupRestorePath", () => {
  it("[neoview.startup-restore.selection] restores the latest non-empty book path", () => {
    expect(readerStartupRestorePath(startupState, {
      initialPath: "",
      hasExternalOpenRequest: false,
    })).toBe("D:/books/latest.cbz")
    expect(readerStartupRestorePath({ ...startupState, lastBook: {
      ...startupState.lastBook!,
      source: { kind: "archive", path: "  " },
    } }, {
      initialPath: "",
      hasExternalOpenRequest: false,
    })).toBeUndefined()
  })

  it("[neoview.startup-restore.precedence] preserves explicit startup and external targets", () => {
    expect(readerStartupRestorePath(startupState, {
      initialPath: "D:/books/explicit.cbz",
      hasExternalOpenRequest: false,
    })).toBeUndefined()
    expect(readerStartupRestorePath(startupState, {
      initialPath: "",
      hasExternalOpenRequest: true,
    })).toBeUndefined()
  })
})
