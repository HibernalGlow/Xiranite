import { useEffect, type ReactNode } from "react"
import { afterEach, expect, test, vi } from "vitest"
import { cleanup, render } from "vitest-browser-react"

import { useWorkspaceStore } from "@/store/workspaceStore"
import { NeoViewKeepAliveProvider, NeoViewKeepAliveSlot } from "./NeoViewKeepAlive"

const WORKSPACE_ID = "neoview-keepalive-browser"
const COMPONENT_ID = "neoview-scroll-state"

afterEach(() => {
  cleanup()
  useWorkspaceStore.setState({ activeWorkspaceId: "default", components: [] })
})

test("[neoview.folder.open-keeps-scroll-gui] keeps the retained NeoView DOM in place when its path is persisted", async () => {
  useWorkspaceStore.setState({
    activeWorkspaceId: WORKSPACE_ID,
    components: [{
      id: COMPONENT_ID,
      moduleId: "neoview",
      state: "docked",
      workspaceId: WORKSPACE_ID,
      data: { path: "C:/books/item-1.cbz" },
    }],
  })
  const lifetime = { mounts: 0, unmounts: 0 }

  function RetainedNode() {
    useEffect(() => {
      lifetime.mounts += 1
      return () => {
        lifetime.unmounts += 1
      }
    }, [])
    return (
      <div data-testid="retained-neoview-node">
        <div data-testid="retained-folder-scroller" style={{ height: 80, overflowY: "auto" }}>
          <div style={{ height: 800 }} />
        </div>
      </div>
    )
  }

  const renderNode = (_compId: string): ReactNode => <RetainedNode />
  await render(
    <NeoViewKeepAliveProvider renderNode={renderNode}>
      <NeoViewKeepAliveSlot compId={COMPONENT_ID} />
    </NeoViewKeepAliveProvider>,
  )

  await expect.poll(() => document.querySelector('[data-testid="retained-neoview-node"]')).not.toBeNull()
  const host = document.querySelector<HTMLElement>(`[data-neoview-keep-alive-host="${COMPONENT_ID}"]`)!
  const slot = document.querySelector<HTMLElement>(`[data-neoview-keepalive-slot="${COMPONENT_ID}"]`)!
  const fallbackRoot = document.querySelector<HTMLElement>('[data-neoview-keepalive-root="true"]')!
  const scroller = document.querySelector<HTMLElement>('[data-testid="retained-folder-scroller"]')!
  const appendToFallback = vi.spyOn(fallbackRoot, "appendChild")
  scroller.scrollTop = 320

  useWorkspaceStore.getState().patchComponentData(COMPONENT_ID, { path: "C:/books/item-40.cbz" })
  await expect.poll(() => useWorkspaceStore.getState().components.find((item) => item.id === COMPONENT_ID)?.data?.path)
    .toBe("C:/books/item-40.cbz")
  await nextPaint()

  expect(host.parentElement).toBe(slot)
  expect(appendToFallback).not.toHaveBeenCalled()
  expect(scroller.scrollTop).toBe(320)
  expect(lifetime).toEqual({ mounts: 1, unmounts: 0 })
})

async function nextPaint(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
}
