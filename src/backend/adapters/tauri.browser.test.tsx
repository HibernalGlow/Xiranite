import { afterEach, expect, test, vi } from "vitest"
import { cleanup, render } from "vitest-browser-react"
import type { NodeLocalFilesCapability } from "@xiranite/contract"
import { createTauriRuntime } from "./tauri"
import { useLocalFileDrop } from "@/nodes/shared/useLocalFileDrop"

/**
 * The hit test that turns Tauri's `tauri://drag-drop` into a target id is only decidable against a real DOM:
 * a stub can prove the arithmetic, but it cannot prove that `elementFromPoint` answers for a child node and
 * that `closest` walks up to the element `useLocalFileDrop` marked. Both are layout facts, so this runs in a
 * real browser and drives the real `window` with an injected `__TAURI__` — the same structural read the
 * adapter does in production.
 */

const DROP_ATTR = "data-local-file-drop-target"

type DropListener = (message: { payload?: unknown }) => void
type SubscribeDrops = NonNullable<NodeLocalFilesCapability["subscribeDrops"]>

/** Install a host window at a given pixel scale; `fire` plays back what the WebView would receive. */
function installFakeHost(scale: number) {
  const listeners: DropListener[] = []
  Object.defineProperty(window, "__TAURI__", {
    configurable: true,
    value: {
      core: { invoke: vi.fn(async (): Promise<unknown> => ({ success: true, supported: true, message: "ok" })) },
      event: {
        listen: async (_event: string, handler: DropListener) => {
          listeners.push(handler)
          return async () => {
            const index = listeners.indexOf(handler)
            if (index >= 0) listeners.splice(index, 1)
          }
        },
      },
    },
  })
  Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: scale })

  const runtime = createTauriRuntime(window)
  /** Mirrors `hostApi.ts`: one native subscription, routed to the target the hit test named. */
  const subscribeDrops: SubscribeDrops = async (targetId, handler) =>
    await runtime.fileDrops.subscribe((event) => {
      if (event.targetId === targetId && event.files.length > 0) handler(event.files)
    })

  return {
    runtime,
    subscribeDrops,
    listenerCount: () => listeners.length,
    fire: (paths: string[], physical: { x: number; y: number }) => {
      // A subscriber may release its listener while the event is being delivered, so iterate a snapshot.
      const snapshot = [...listeners]
      for (const listener of snapshot) listener({ payload: { paths, position: physical } })
    },
  }
}

function TwoTargets(props: {
  subscribeDrops: SubscribeDrops
  onLeftDrop: (paths: string[]) => void
  onRightDrop: (paths: string[]) => void
}) {
  const left = useLocalFileDrop({ subscribeDrops: props.subscribeDrops, onDropPaths: props.onLeftDrop })
  const right = useLocalFileDrop({ subscribeDrops: props.subscribeDrops, onDropPaths: props.onRightDrop })
  return (
    // The top offset keeps the scaled control case below arithmetically outside both boxes at any layout.
    <div data-testid="board" style={{ position: "relative", marginTop: 60, width: 620, height: 220 }}>
      <div {...left.targetProps} data-testid="left-target" style={{ position: "absolute", left: 0, top: 0, width: 200, height: 200 }}>
        {/* The drop lands on this child; only `closest` can reach the marked ancestor above it. */}
        <div data-testid="left-child" style={{ width: "100%", height: "100%" }} />
      </div>
      <div {...right.targetProps} data-testid="right-target" style={{ position: "absolute", left: 400, top: 0, width: 200, height: 200 }} />
    </div>
  )
}

function rect(container: HTMLElement, testId: string): DOMRect {
  return container.querySelector(`[data-testid="${testId}"]`)!.getBoundingClientRect()
}

function center(of: DOMRect): { x: number; y: number } {
  return { x: of.left + of.width / 2, y: of.top + of.height / 2 }
}

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, "__TAURI__")
  Reflect.deleteProperty(window, "devicePixelRatio")
})

test("a 2x drop over the marked ancestor's child routes to that target and shares one native listener", async () => {
  const onLeftDrop = vi.fn()
  const onRightDrop = vi.fn()
  const host = installFakeHost(2)
  const { container } = await render(<TwoTargets subscribeDrops={host.subscribeDrops} onLeftDrop={onLeftDrop} onRightDrop={onRightDrop} />)

  // Two mounted targets, one registration: the shared native listener is the point of this seam.
  await vi.waitFor(() => expect(host.listenerCount()).toBe(1))

  // The hook must stamp the attribute the adapter selects on, or no drop is ever attributed.
  const marked = container.querySelectorAll(`[${DROP_ATTR}]`)
  expect(marked.length).toBe(2)
  expect(container.querySelector('[data-testid="left-target"]')!.getAttribute(DROP_ATTR)).toBeTruthy()

  const point = center(rect(container, "left-child"))
  host.fire(["/tmp/boxed.zip"], { x: point.x * 2, y: point.y * 2 })

  expect(onLeftDrop).toHaveBeenCalledWith(["/tmp/boxed.zip"])
  expect(onRightDrop).not.toHaveBeenCalled()
})

/// Control: the same drop sent as if the display were unscaled never names that target, so the case above measures the division.
test("the unscaled reading of a 2x point does not reach the target it belongs to", async () => {
  const onRightDrop = vi.fn()
  const host = installFakeHost(2)
  const { container } = await render(<TwoTargets subscribeDrops={host.subscribeDrops} onLeftDrop={vi.fn()} onRightDrop={onRightDrop} />)
  await vi.waitFor(() => expect(host.listenerCount()).toBe(1))

  const rightId = container.querySelector('[data-testid="right-target"]')!.getAttribute(DROP_ATTR)!
  const observed: Array<string | undefined> = []
  await host.runtime.fileDrops.subscribe((event) => observed.push(event.targetId))

  host.fire(["/tmp/mis-scaled.txt"], center(rect(container, "right-target")))

  expect(observed.at(-1)).not.toBe(rightId)
  expect(onRightDrop).not.toHaveBeenCalled()
})

test("a drop in the gap between targets is delivered without a target id, so the host can report it as unsupported", async () => {
  const host = installFakeHost(1)
  const { container } = await render(<TwoTargets subscribeDrops={host.subscribeDrops} onLeftDrop={vi.fn()} onRightDrop={vi.fn()} />)
  await vi.waitFor(() => expect(host.listenerCount()).toBe(1))

  const seen: Array<{ files: string[]; targetId?: string }> = []
  await host.runtime.fileDrops.subscribe((event) => seen.push(event))

  const left = rect(container, "left-target")
  const right = rect(container, "right-target")
  host.fire(["/tmp/in-the-gap.txt"], { x: (left.right + right.left) / 2, y: left.top + 20 })

  expect(seen).toEqual([{ files: ["/tmp/in-the-gap.txt"] }])
})
