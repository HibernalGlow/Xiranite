import { act, renderHook } from "@testing-library/react"
import { expect, it, vi } from "vitest"

import { useReaderActivationIdentity } from "./useReaderActivationIdentity"

it("restores a Card's complete expanded cursor when reopening the Reader session", () => {
  const identity = {
    readerSourcePath: "D:/books/series/Book 2",
    activatedEntryPath: "D:/books/series/Book 2",
    traversalRootPath: "D:/books",
    traversalFrames: [
      { directoryPath: "D:/books", currentEntryPath: "D:/books/series" },
      { directoryPath: "D:/books/series", currentEntryPath: "D:/books/series/Book 2" },
    ],
  }
  const committed = vi.fn()
  const { result } = renderHook(() => useReaderActivationIdentity({
    initialPath: identity.readerSourcePath,
    initialActivationIdentity: identity,
    onActivationIdentityCommitted: committed,
  }))

  expect(result.current.provenanceForOpen(identity.readerSourcePath)).toEqual({
    browserOriginPath: "D:/books",
    browserOriginEntryPath: "D:/books/series/Book 2",
    browserOriginTraversalFrames: identity.traversalFrames,
  })
  act(() => result.current.clear())
  expect(committed).toHaveBeenLastCalledWith(undefined)
})
