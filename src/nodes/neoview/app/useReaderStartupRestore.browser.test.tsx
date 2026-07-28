import { expect, test, vi } from "vitest"
import { page } from "vitest/browser"
import { render } from "vitest-browser-react"
import { useEffect, useMemo } from "react"

import type { ReaderHttpClient } from "../adapters/reader-http-client"
import { useReaderStartupRestore } from "./useReaderStartupRestore"

function StartupRestoreProbe({
  client,
  initialPath = "",
  externalOpenRequest,
  open,
  startupEnabled = true,
  onError,
}: {
  client: ReaderHttpClient
  initialPath?: string
  externalOpenRequest?: { requestId: string; path: string; kind: "file" | "directory" }
  open: (path: string) => Promise<unknown>
  startupEnabled?: boolean
  onError?: (cause: unknown) => void
}) {
  const config = useMemo(() => ({ restoreLastBook: startupEnabled }), [startupEnabled])
  const startupRestore = useReaderStartupRestore({ client, initialPath, externalOpenRequest, open, onError })
  useEffect(() => startupRestore.hydrate(config), [config, startupRestore.hydrate])
  return (
    <>
      <span aria-label="startup restore state">{String(startupRestore.restoreLastBook)}</span>
      <button type="button" onClick={() => void startupRestore.setRestoreLastBook(false)}>disable</button>
    </>
  )
}

test("[neoview.startup-restore.hook-gui] opens the latest book once after mount", async () => {
  const open = vi.fn(async () => undefined)
  const startupState = vi.fn(async () => ({
    lastFolder: null,
    lastBook: {
      bookId: "latest-book",
      source: { kind: "archive" as const, path: "D:/books/latest.cbz" },
      displayName: "latest.cbz",
      pageIndex: 3,
      pageCount: 12,
      updatedAt: 2,
    },
  }))

  await render(<StartupRestoreProbe client={{ startupState } as ReaderHttpClient} open={open} />)

  await expect.poll(() => startupState).toHaveBeenCalledWith(expect.any(AbortSignal))
  await expect.poll(() => open).toHaveBeenCalledOnce()
  expect(open).toHaveBeenCalledWith("D:/books/latest.cbz")
})

test("[neoview.startup-restore.hook-gui] leaves an external target in control", async () => {
  const open = vi.fn(async () => undefined)
  const startupState = vi.fn(async () => ({ lastFolder: null, lastBook: null }))

  await render(
    <StartupRestoreProbe
      client={{ startupState } as ReaderHttpClient}
      externalOpenRequest={{ requestId: "external-1", path: "D:/books/external.cbz", kind: "file" }}
      open={open}
    />,
  )

  await expect.poll(() => startupState).not.toHaveBeenCalled()
  expect(open).not.toHaveBeenCalled()
})

test("[neoview.startup-restore.disabled-gui] does not read startup state when the persisted preference is off", async () => {
  const open = vi.fn(async () => undefined)
  const startupState = vi.fn(async () => ({ lastFolder: null, lastBook: null }))

  await render(<StartupRestoreProbe client={{ startupState } as ReaderHttpClient} open={open} startupEnabled={false} />)

  await expect.poll(() => startupState).not.toHaveBeenCalled()
  expect(open).not.toHaveBeenCalled()
})

test("[neoview.startup-restore.rollback-gui] rolls a failed checkbox write back to the persisted value", async () => {
  const updateStartup = vi.fn(async () => { throw new Error("config unavailable") })
  const onError = vi.fn()

  await render(
    <StartupRestoreProbe
      client={{ startupState: vi.fn(async () => ({ lastFolder: null, lastBook: null })), updateStartup } as ReaderHttpClient}
      open={vi.fn(async () => undefined)}
      onError={onError}
    />,
  )

  await page.getByRole("button", { name: "disable" }).click()
  await expect.poll(() => updateStartup).toHaveBeenCalledWith({ startup: { restoreLastBook: false } })
  await expect.poll(() => onError).toHaveBeenCalledOnce()
  await expect.element(page.getByLabelText("startup restore state")).toHaveTextContent("true")
})
