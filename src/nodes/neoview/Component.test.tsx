import { cleanup, render } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import type { NodeComponentProps } from "@xiranite/contract"

const readerProps = vi.hoisted(() => ({ current: undefined as Record<string, unknown> | undefined }))
vi.mock("./app/ReaderApp", () => ({ ReaderApp: (props: Record<string, unknown>) => { readerProps.current = props; return null } }))
import { Component, type NeoViewCardState } from "./Component"

afterEach(cleanup)

it("[neoview.book-information.host-clipboard] passes only the host clipboard writer into ReaderApp", () => {
  const writeText = vi.fn(async () => undefined)
  const host = {
    state: { getData: () => ({ path: "D:/book.cbz" }), patchData: vi.fn() },
    clipboard: { writeText },
    localFiles: {},
  } as unknown as NodeComponentProps<NeoViewCardState>["host"]
  render(<Component compId="neoview-1" host={host} />)
  expect(readerProps.current).toMatchObject({ sessionScopeId: "neoview-1", initialPath: "D:/book.cbz", copyText: writeText })
  expect(readerProps.current).not.toHaveProperty("host")
})

it("[neoview.folder.penetration-browser-origin-state] restores and persists the File Card browser origin separately from the Reader path", () => {
  const patchData = vi.fn()
  const host = {
    state: {
      getData: () => ({ path: "D:/books/series/volume", browserOriginPath: "D:/books" }),
      patchData,
    },
    clipboard: {},
    localFiles: {},
  } as unknown as NodeComponentProps<NeoViewCardState>["host"]

  render(<Component compId="neoview-1" host={host} />)
  expect(readerProps.current).toMatchObject({
    initialPath: "D:/books/series/volume",
    initialBrowserOriginPath: "D:/books",
  })

  const onPathCommitted = readerProps.current?.onPathCommitted as (path: string, browserOriginPath?: string) => void
  onPathCommitted("D:/books/series/volume-2", "D:/books")
  expect(patchData).toHaveBeenCalledWith({ path: "D:/books/series/volume-2", browserOriginPath: "D:/books" })
})
