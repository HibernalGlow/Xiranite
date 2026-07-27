import { afterEach, expect, test } from "vitest"
import { render, cleanup } from "vitest-browser-react"
import { useEffect, useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  WorkspaceMelodeckPanel,
  WorkspaceMelodeckProvider,
  useWorkspaceMelodeck,
} from "@/components/workspace/WorkspaceMelodeck"
import { useWorkspaceStore } from "@/store/workspaceStore"
import "@hibernalglow/folia-player/styles.css"

afterEach(() => {
  cleanup()
  useWorkspaceStore.getState().setChromePosition("right")
})

test("resizes the floating player locally before persisting its final size", async () => {
  useWorkspaceStore.getState().setChromePosition("island")
  await render(<FloatingMelodeckHarness />)

  const panel = document.querySelector<HTMLElement>('[data-melodeck="panel"]')!
  const stateProbe = document.querySelector<HTMLElement>("output[data-melodeck-floating-size]")!
  await expect.poll(() => panel.getAttribute("data-melodeck-projection")).toBe("direct")
  await expect.poll(() => panel.getAttribute("data-melodeck-mode")).toBe("floating")
  expect(panel.getAttribute("data-melodeck-floating-size")).toBe("384x680")
  expect(panel.style.width).toBe("384px")
  expect(panel.style.height).toBe("680px")

  const resizeHandle = panel.querySelector<HTMLButtonElement>('[data-melodeck-part="floating-resize-handle"]')!
  expect(resizeHandle).not.toBeNull()
  startResize(resizeHandle, 41)
  moveResize(41, 440, 440)
  await expect.poll(() => panel.getAttribute("data-melodeck-floating-size")).toBe("424x720")
  expect(stateProbe.getAttribute("data-melodeck-floating-size")).toBe("384x680")
  window.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 41 }))
  await expect.poll(() => panel.getAttribute("data-melodeck-floating-size")).toBe("384x680")

  startResize(resizeHandle, 42)
  moveResize(42, 460, 480)
  await expect.poll(() => panel.getAttribute("data-melodeck-floating-size")).toBe("444x760")
  expect(stateProbe.getAttribute("data-melodeck-floating-size")).toBe("384x680")
  window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 42 }))
  await expect.poll(() => stateProbe.getAttribute("data-melodeck-floating-size")).toBe("444x760")
})

function startResize(resizeHandle: HTMLButtonElement, pointerId: number) {
  resizeHandle.dispatchEvent(new PointerEvent("pointerdown", {
    bubbles: true,
    cancelable: true,
    button: 0,
    pointerId,
    clientX: 400,
    clientY: 400,
  }))
}

function moveResize(pointerId: number, clientX: number, clientY: number) {
  window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId, clientX, clientY }))
}

function FloatingMelodeckHarness() {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  }))

  return (
    <QueryClientProvider client={queryClient}>
      <div className="relative h-screen w-full bg-background text-foreground">
        <WorkspaceMelodeckProvider>
          <FloatingMelodeckSetup />
          <FloatingSizeProbe />
          <WorkspaceMelodeckPanel />
        </WorkspaceMelodeckProvider>
      </div>
    </QueryClientProvider>
  )
}

function FloatingMelodeckSetup() {
  const { setCollapsed, setMode, setPlayerEngine, setSurfaceMounted, startPlayer } = useWorkspaceMelodeck()

  useEffect(() => {
    startPlayer()
    setPlayerEngine("folia")
    setMode("floating")
    setSurfaceMounted(true)
    setCollapsed(false)
  }, [setCollapsed, setMode, setPlayerEngine, setSurfaceMounted, startPlayer])

  return null
}

function FloatingSizeProbe() {
  const { floatingSize } = useWorkspaceMelodeck()
  return <output data-melodeck-floating-size={`${floatingSize.width}x${floatingSize.height}`} />
}
