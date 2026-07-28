import { act, cleanup, render, waitFor } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import type { NodeComponentProps } from "@xiranite/contract"

const readerProps = vi.hoisted(() => ({ current: undefined as Record<string, unknown> | undefined }))
const acknowledge = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock("./app/ReaderApp", () => ({ ReaderApp: (props: Record<string, unknown>) => { readerProps.current = props; return null } }))
vi.mock("@wailsio/runtime", () => ({ Call: { ByName: acknowledge } }))
import { publishExternalNodeLaunch, resetExternalNodeLaunchDeliveryForTests } from "@/external-node-host/externalNodeLaunchDelivery"
import { Component, type NeoViewCardState } from "./Component"

afterEach(() => {
  cleanup()
  resetExternalNodeLaunchDeliveryForTests()
})

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

it("[neoview.folder.penetration-browser-origin-state] restores and persists the File Card browser origin and activation root separately from the Reader path", () => {
  const patchData = vi.fn()
  const host = {
    state: {
      getData: () => ({ path: "D:/books/series/volume", browserOriginPath: "D:/books", activationRootPath: "D:/books/series" }),
      patchData,
    },
    clipboard: {},
    localFiles: {},
  } as unknown as NodeComponentProps<NeoViewCardState>["host"]

  render(<Component compId="neoview-1" host={host} />)
  expect(readerProps.current).toMatchObject({
    initialPath: "D:/books/series/volume",
    initialBrowserOriginPath: "D:/books",
    initialActivationRootPath: "D:/books/series",
  })

  const onPathCommitted = readerProps.current?.onPathCommitted as (path: string, browserOriginPath?: string, activationRootPath?: string) => void
  onPathCommitted("D:/books/series/volume-2", "D:/books", "D:/books/series")
  expect(patchData).toHaveBeenCalledWith({
    path: "D:/books/series/volume-2",
    browserOriginPath: "D:/books",
    activationRootPath: "D:/books/series",
  })
})

it("persists the two fullscreen states independently in the NeoView Card state", () => {
  const patchData = vi.fn()
  const host = {
    state: {
      getData: () => ({ swimlaneSoloLaneId: "reader", readerViewFullscreen: true }),
      patchData,
    },
    clipboard: {},
    localFiles: {},
  } as unknown as NodeComponentProps<NeoViewCardState>["host"]

  render(<Component compId="neoview-1" host={host} />)
  expect(readerProps.current).toMatchObject({
    initialSwimlaneSoloLaneId: "reader",
    initialReaderViewFullscreen: true,
  })

  const onSwimlaneSoloLaneIdCommitted = readerProps.current?.onSwimlaneSoloLaneIdCommitted as (laneId: string | null) => void
  onSwimlaneSoloLaneIdCommitted(null)
  expect(patchData).toHaveBeenCalledWith({ swimlaneSoloLaneId: null })

  const onReaderViewFullscreenCommitted = readerProps.current?.onReaderViewFullscreenCommitted as (fullscreen: boolean) => void
  onReaderViewFullscreenCommitted(false)
  expect(patchData).toHaveBeenCalledWith({ readerViewFullscreen: false })
})

it("keeps a reused external launch available across a NeoView subtree recreation", async () => {
  const patchData = vi.fn()
  const host = {
    state: { getData: () => ({ path: "D:/books/current.cbz" }), patchData },
    clipboard: {},
    localFiles: {},
  } as unknown as NodeComponentProps<NeoViewCardState>["host"]
  Object.assign(window, { _wails: {} })
  acknowledge.mockClear()

  const first = render(<Component compId="neoview-external" host={host} />)
  await act(async () => {
    publishExternalNodeLaunch({
      version: 1,
      requestId: "external-1",
      source: "explorer",
      nodeId: "neoview",
      intent: "open",
      targets: [{ kind: "file", uri: "file:///D:/books/external.cbz" }],
    })
  })

  expect(readerProps.current).toMatchObject({
    initialPath: "D:/books/current.cbz",
    externalOpenRequest: { requestId: "external-1", path: "D:/books/external.cbz" },
  })
  expect(acknowledge).not.toHaveBeenCalled()

  const onExternalOpenResult = readerProps.current?.onExternalOpenResult as (result: { requestId: string; opened: boolean; message?: string }) => void
  await act(async () => onExternalOpenResult({ requestId: "external-1", opened: false, message: "Unsupported file type." }))
  await waitFor(() => expect(acknowledge).toHaveBeenCalledWith(
    "main.XiraniteService.AcknowledgeExternalNodeLaunch",
    { requestId: "external-1", accepted: false, message: "Unsupported file type." },
  ))
  expect(patchData).not.toHaveBeenCalled()

  await act(async () => {
    publishExternalNodeLaunch({
      version: 1,
      requestId: "external-directory",
      source: "explorer",
      nodeId: "neoview",
      intent: "open",
      targets: [{ kind: "directory", uri: "file:///D:/books/library" }],
    })
  })
  first.unmount()
  render(<Component compId="neoview-external" host={host} />)
  expect(readerProps.current).toMatchObject({
    externalOpenRequest: { requestId: "external-directory", path: "D:/books/library", kind: "directory" },
  })

  const onDirectoryResult = readerProps.current?.onExternalOpenResult as (result: { requestId: string; opened: boolean; message?: string }) => void
  await act(async () => onDirectoryResult({ requestId: "external-directory", opened: true }))
  await waitFor(() => expect(acknowledge).toHaveBeenCalledWith(
    "main.XiraniteService.AcknowledgeExternalNodeLaunch",
    { requestId: "external-directory", accepted: true, message: undefined },
  ))
})
