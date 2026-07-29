import { expect, test, vi } from "vitest"

import { openReaderExternalTarget } from "./ReaderExternalOpenCoordinator"

test("opens a file in Reader and positions Folder before resolving the launch", async () => {
  const reader = deferred<{ opened: boolean }>()
  const folder = deferred<{ opened: boolean }>()
  const prepareFolder = vi.fn()
  const openReader = vi.fn(() => reader.promise)
  const openFolder = vi.fn(() => folder.promise)

  let settled = false
  const result = openReaderExternalTarget(
    { requestId: "file-1", path: " D:/books/demo.cbz ", kind: "file" },
    { prepareFolder, openReader, openFolder },
  ).finally(() => { settled = true })

  expect(prepareFolder).toHaveBeenCalledWith({ requestId: "file-1", path: "D:/books/demo.cbz", kind: "file" })
  expect(openReader).toHaveBeenCalledWith("D:/books/demo.cbz")
  expect(openFolder).toHaveBeenCalledWith({ requestId: "file-1", path: "D:/books/demo.cbz", kind: "file" })
  reader.resolve({ opened: true })
  await Promise.resolve()
  expect(settled).toBe(false)
  folder.resolve({ opened: true })

  await expect(result).resolves.toEqual({ opened: true })
})

test("reports which side of a coordinated file launch failed", async () => {
  await expect(openReaderExternalTarget(
    { requestId: "file-2", path: "D:/books/demo.cbz", kind: "file" },
    {
      prepareFolder: vi.fn(),
      openReader: async () => ({ opened: true }),
      openFolder: async () => ({ opened: false, message: "selection unavailable" }),
    },
  )).resolves.toEqual({ opened: false, message: "Folder: selection unavailable" })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve })
  return { promise, resolve }
}
